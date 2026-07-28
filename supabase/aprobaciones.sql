-- ShopFlow — APROBACIÓN REMOTA DEL ESTIMADO (la puerta anónima)
-- =============================================================================
-- QUÉ RESUELVE: hoy el cliente abre el link, ve el presupuesto y le da a "Aprobar",
-- pero eso solo abre un WhatsApp — la aprobación se queda en el chat y el taller la
-- tiene que registrar a mano. Si mañana el cliente dice "yo nunca autoricé eso", el
-- único rastro es un mensaje que se puede borrar.
-- Con esto, el cliente aprueba DESDE EL LINK y el registro lo hace el SERVIDOR:
-- fecha y hora del servidor (no del taller), nombre que escribió, IP y navegador.
-- El taller no lo puede fabricar después: es evidencia, no una nota.
--
-- CÓMO SE PEGA: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Es idempotente: se puede correr otra vez sin romper nada.
--
-- POR QUÉ UNA TABLA APARTE Y NO `shops`: `shops` está cerrada por RLS a auth.uid()
-- = dueño, y el cliente NO tiene cuenta. Abrirle un hueco a `shops` sería darle una
-- rendija anónima a TODA la base de datos del taller. Aquí la puerta anónima solo
-- puede tocar dos funciones, y esas funciones solo saben responder por un token de
-- 128 bits que ya tiene en la mano.
-- =============================================================================

-- ============ TABLA ============
create table if not exists public.aprobaciones (
  token       text primary key,                    -- 128 bits al azar; vive en el link del cliente
  owner       uuid not null references auth.users(id) on delete cascade,
  ro          text not null,                       -- id de la orden (RO-12)
  cliente     text,
  vehiculo    text,
  total       numeric(12,2) not null default 0,    -- POR CUÁNTO se le pidió el sí
  fp          text,                                -- huella de la orden cuando se mandó el link
  creado      timestamptz not null default now(),
  expira      timestamptz not null default (now() + interval '45 days'),
  decision    text check (decision in ('aprobado','rechazado')),
  decidido_at timestamptz,                         -- hora del SERVIDOR, no del taller
  nombre      text,
  nota        text,
  ip          text,
  ua          text,
  aplicado_at timestamptz                          -- cuándo lo bajó la app del taller
);
create index if not exists aprob_owner_idx on public.aprobaciones(owner, decidido_at);
create index if not exists aprob_pend_idx  on public.aprobaciones(owner) where aplicado_at is null;

-- ============ SEGURIDAD ============
alter table public.aprobaciones enable row level security;

-- el cliente anónimo NUNCA toca la tabla; solo las dos funciones de abajo
revoke all on public.aprobaciones from anon;
grant select, insert, update, delete on public.aprobaciones to authenticated;

drop policy if exists "aprob_owner_sel" on public.aprobaciones;
create policy "aprob_owner_sel" on public.aprobaciones for select using (auth.uid() = owner);
drop policy if exists "aprob_owner_ins" on public.aprobaciones;
create policy "aprob_owner_ins" on public.aprobaciones for insert with check (auth.uid() = owner);
drop policy if exists "aprob_owner_upd" on public.aprobaciones;
create policy "aprob_owner_upd" on public.aprobaciones for update using (auth.uid() = owner) with check (auth.uid() = owner);
drop policy if exists "aprob_owner_del" on public.aprobaciones;
create policy "aprob_owner_del" on public.aprobaciones for delete using (auth.uid() = owner);

-- ============ CANDADO: una aprobación decidida no se puede reescribir ============
-- Sin esto, el taller (o un bug de la app) podría cambiarle el monto a una aprobación
-- YA dada — que es exactamente lo que esta pieza existe para impedir. Lo único que se
-- puede tocar después de decidida es `aplicado_at` (que la app la bajó).
create or replace function public.aprob_guard() returns trigger
language plpgsql as $$
begin
  if old.decidido_at is not null then
    if new.total is distinct from old.total
       or new.fp is distinct from old.fp
       or new.ro is distinct from old.ro
       or new.owner is distinct from old.owner
       or new.decision is distinct from old.decision
       or new.decidido_at is distinct from old.decidido_at
       or new.nombre is distinct from old.nombre
       or new.nota is distinct from old.nota
       or new.ip is distinct from old.ip then
      raise exception 'aprobacion-decidida: esta aprobación ya está firmada y no se puede alterar';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists aprob_guard_t on public.aprobaciones;
create trigger aprob_guard_t before update on public.aprobaciones
  for each row execute function public.aprob_guard();

-- ============ FRENO DE INTENTOS (rate limit por IP) ============
create table if not exists public.aprob_rl (
  k       text primary key,
  ventana timestamptz not null default now(),
  n       int not null default 0
);
alter table public.aprob_rl enable row level security;   -- sin policies = nadie desde el cliente
revoke all on public.aprob_rl from anon, authenticated;

create or replace function public.aprob_ip() returns text
language sql stable as $$
  select coalesce(
    nullif(trim(split_part(
      coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
      ',', 1)), ''),
    'anon');
$$;

create or replace function public.aprob_rate_ok(p_k text, p_max int, p_win interval) returns boolean
language plpgsql security definer set search_path = public as $$
declare r public.aprob_rl%rowtype;
begin
  if random() < 0.01 then delete from public.aprob_rl where ventana < now() - interval '1 day'; end if;
  insert into public.aprob_rl(k) values (p_k) on conflict (k) do nothing;
  select * into r from public.aprob_rl where k = p_k for update;
  if r.ventana < now() - p_win then
    update public.aprob_rl set ventana = now(), n = 1 where k = p_k;
    return true;
  end if;
  if r.n >= p_max then return false; end if;
  update public.aprob_rl set n = n + 1 where k = p_k;
  return true;
end $$;

-- ============ PUERTA 1: ver el estado de una aprobación ============
-- Responde SOLO por un token exacto. Sin token no hay listado, ni búsqueda, ni conteo.
create or replace function public.aprob_ver(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare a public.aprobaciones%rowtype;
begin
  if p_token is null or length(p_token) < 16 then return json_build_object('ok', false, 'err', 'token'); end if;
  if not public.aprob_rate_ok('v:' || public.aprob_ip(), 60, interval '10 minutes') then
    return json_build_object('ok', false, 'err', 'rate');
  end if;
  select * into a from public.aprobaciones where token = p_token;
  if not found then return json_build_object('ok', false, 'err', 'no'); end if;
  if a.expira < now() then return json_build_object('ok', false, 'err', 'vencido'); end if;
  return json_build_object('ok', true, 'ro', a.ro, 'total', a.total,
                           'decision', a.decision, 'decidido_at', a.decidido_at, 'nombre', a.nombre);
end $$;

-- ============ PUERTA 2: el cliente decide ============
create or replace function public.aprob_registrar(p_token text, p_decision text, p_nombre text, p_nota text) returns json
language plpgsql security definer set search_path = public as $$
declare a public.aprobaciones%rowtype; v_ip text; v_ua text;
begin
  if p_decision is null or p_decision not in ('aprobado', 'rechazado') then
    return json_build_object('ok', false, 'err', 'decision');
  end if;
  if p_token is null or length(p_token) < 16 then return json_build_object('ok', false, 'err', 'token'); end if;
  v_ip := public.aprob_ip();
  if not public.aprob_rate_ok('r:' || v_ip, 20, interval '10 minutes') then
    return json_build_object('ok', false, 'err', 'rate');
  end if;
  select * into a from public.aprobaciones where token = p_token for update;
  if not found then return json_build_object('ok', false, 'err', 'no'); end if;
  if a.expira < now() then return json_build_object('ok', false, 'err', 'vencido'); end if;
  -- dos taps en el mismo botón no crean dos aprobaciones: la primera manda
  if a.decidido_at is not null then
    return json_build_object('ok', true, 'ya', true, 'decision', a.decision,
                             'decidido_at', a.decidido_at, 'total', a.total, 'nombre', a.nombre);
  end if;
  v_ua := left(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', ''), 200);
  update public.aprobaciones set
    decision    = p_decision,
    decidido_at = now(),
    nombre      = left(coalesce(nullif(btrim(p_nombre), ''), '(sin nombre)'), 60),
    nota        = left(coalesce(p_nota, ''), 300),
    ip          = v_ip,
    ua          = v_ua
  where token = p_token;
  select * into a from public.aprobaciones where token = p_token;
  return json_build_object('ok', true, 'decision', a.decision, 'decidido_at', a.decidido_at,
                           'total', a.total, 'nombre', a.nombre);
end $$;

-- solo las dos puertas quedan abiertas al público; el freno de intentos no
revoke all on function public.aprob_rate_ok(text, int, interval) from public, anon, authenticated;
revoke all on function public.aprob_ver(text) from public;
revoke all on function public.aprob_registrar(text, text, text, text) from public;
grant execute on function public.aprob_ver(text) to anon, authenticated;
grant execute on function public.aprob_registrar(text, text, text, text) to anon, authenticated;

-- ============ REALTIME (el taller se entera al instante) ============
do $$
begin
  alter publication supabase_realtime add table public.aprobaciones;
exception when duplicate_object then null;
end $$;

-- ============ COMPROBACIÓN RÁPIDA ============
-- select public.aprob_ver('0000000000000000');        -- debe dar {"ok":false,"err":"no"}
-- select public.aprob_registrar('x','aprobado','a',''); -- debe dar {"ok":false,"err":"token"}
