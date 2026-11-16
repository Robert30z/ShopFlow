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
-- 15-nov-2026 (NEXO): v2 = APROBACION PUNTO POR PUNTO + candados de Codex.
-- Este archivo NUNCA se habia corrido en el proyecto, asi que se reescribe completo
-- (respaldo: aprobaciones.sql.bak-1115). Todo vive en UN archivo: correrlo otra vez
-- no puede dejar un candado viejo encima de uno nuevo.
--   * El cliente decide cada trabajo (si/no). decision = aprobado | parcial | rechazado.
--   * La firma SOLO la puede escribir el servidor (las dos puertas). El taller no la puede
--     fabricar al insertar, ni ponerla al actualizar, ni borrar una fila ya firmada.
--   * El cliente manda la huella (fp) de lo que vio: si el taller cambio algo, no firma.
--   * Precios e ids se validan antes de sumar; la suma la hace el servidor.

-- ============ TABLA ============
create table if not exists public.aprobaciones (
  token       text primary key,                    -- 128 bits al azar; vive en el link del cliente
  owner       uuid not null references auth.users(id) on delete restrict,
  ro          text not null,                       -- id de la orden (RO-12)
  cliente     text,
  vehiculo    text,
  total       numeric(12,2) not null default 0,    -- total del estimado que se le enseno
  fp          text,                                -- huella de la orden cuando se mando el link
  items       jsonb,                               -- [{"id":"s1","nombre":"Pastillas delanteras","precio":139}]
  creado      timestamptz not null default now(),
  expira      timestamptz not null default (now() + interval '45 days'),
  decision    text check (decision in ('aprobado','parcial','rechazado')),
  decisiones  jsonb,                               -- {"s1":"si","s2":"no"}
  total_aprobado numeric(12,2),                    -- suma de lo que dijo que si (la calcula el servidor)
  decidido_at timestamptz,                         -- hora del SERVIDOR, no del taller
  nombre      text,
  nota        text,
  ip          text,
  ua          text,
  aplicado_at timestamptz                          -- cuando lo bajo la app del taller
);
-- por si una version vieja de la tabla ya existiera (la v1 nunca se corrio, pero por si acaso)
alter table public.aprobaciones add column if not exists items jsonb;
alter table public.aprobaciones add column if not exists decisiones jsonb;
alter table public.aprobaciones add column if not exists total_aprobado numeric(12,2);
alter table public.aprobaciones drop constraint if exists aprobaciones_decision_check;
alter table public.aprobaciones add constraint aprobaciones_decision_check
  check (decision in ('aprobado','parcial','rechazado'));
alter table public.aprobaciones drop constraint if exists aprob_token_largo;
alter table public.aprobaciones add constraint aprob_token_largo check (token ~ '^[0-9a-f]{32}$');   -- _aprobToken(): 16 bytes al azar en hex
create index if not exists aprob_owner_idx on public.aprobaciones(owner, decidido_at);
create index if not exists aprob_pend_idx  on public.aprobaciones(owner) where aplicado_at is null;

-- ============ SEGURIDAD ============
alter table public.aprobaciones enable row level security;
revoke all on public.aprobaciones from anon;
grant select, insert, update, delete on public.aprobaciones to authenticated;

drop policy if exists "aprob_owner_sel" on public.aprobaciones;
create policy "aprob_owner_sel" on public.aprobaciones for select using (auth.uid() = owner);
drop policy if exists "aprob_owner_ins" on public.aprobaciones;
create policy "aprob_owner_ins" on public.aprobaciones for insert with check (auth.uid() = owner);
drop policy if exists "aprob_owner_upd" on public.aprobaciones;
create policy "aprob_owner_upd" on public.aprobaciones for update using (auth.uid() = owner) with check (auth.uid() = owner);
drop policy if exists "aprob_owner_del" on public.aprobaciones;
create policy "aprob_owner_del" on public.aprobaciones for delete using (auth.uid() = owner and decidido_at is null);

-- ============ CANDADO ============
-- Las puertas (security definer) corren como el dueno de la funcion, no como 'authenticated'.
-- Asi se distingue "lo escribio el servidor" de "lo escribio la app del taller".
create or replace function public.aprob_guard() returns trigger
language plpgsql as $$
declare desde_app boolean := current_user in ('authenticated', 'anon');
begin
  if tg_op = 'DELETE' then
    if old.decidido_at is not null then
      raise exception 'aprobacion-decidida: una aprobación firmada no se borra';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if desde_app and (new.decision is not null or new.decidido_at is not null or new.decisiones is not null
       or new.total_aprobado is not null or new.nombre is not null or new.nota is not null
       or new.ip is not null or new.ua is not null or new.aplicado_at is not null) then
      raise exception 'aprobacion-firma: la firma solo la escribe el servidor';
    end if;
    return new;
  end if;
  -- UPDATE
  if new.token is distinct from old.token then
    raise exception 'aprobacion-token: el token no se cambia';
  end if;
  if new.aplicado_at is distinct from old.aplicado_at and (old.aplicado_at is not null or old.decidido_at is null) then
    raise exception 'aprobacion-aplicada: solo se marca una vez, y solo despues de firmada';
  end if;
  if old.decidido_at is not null then
    if (to_jsonb(new) - 'aplicado_at') is distinct from (to_jsonb(old) - 'aplicado_at') then
      raise exception 'aprobacion-decidida: esta aprobación ya está firmada y no se puede alterar';
    end if;
  elsif desde_app and (new.decision is not null or new.decidido_at is not null or new.decisiones is not null
       or new.total_aprobado is not null or new.nombre is not null or new.nota is not null
       or new.ip is not null or new.ua is not null) then
    raise exception 'aprobacion-firma: la firma solo la escribe el servidor';
  end if;
  return new;
end $$;

drop trigger if exists aprob_guard_t on public.aprobaciones;
create trigger aprob_guard_t before insert or update or delete on public.aprobaciones
  for each row execute function public.aprob_guard();

-- ============ HUELLA DEL SERVIDOR ============
-- Lo que el cliente vio (items + total), calculado AQUI. La puerta 1 se la da al cliente y la puerta 3
-- exige la misma: si el taller cambio un precio o un trabajo entre medio, no hay firma.
create or replace function public.aprob_huella(p_items jsonb, p_total numeric) returns text
language sql immutable as $$
  select md5(coalesce(p_items::text, '') || '|' || coalesce(p_total::text, ''));
$$;

-- ============ VALIDAR ITEMS (lo usan las puertas) ============
-- Devuelve null si los items estan bien; si no, el motivo. Nunca revienta (no hay cast sin revisar).
create or replace function public.aprob_items_mal(p_items jsonb) returns text
language plpgsql immutable as $$
declare it jsonb; ids text[] := '{}'; v_id text; v_p text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return 'items'; end if;
  if jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 60 then return 'items-cantidad'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(it) <> 'object' then return 'item'; end if;
    v_id := it ->> 'id';
    if v_id is null or length(v_id) = 0 or length(v_id) > 40 then return 'item-id'; end if;
    if v_id = any(ids) then return 'item-id-repetido'; end if;
    ids := ids || v_id;
    v_p := it ->> 'precio';
    if v_p is null or v_p !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' then return 'item-precio'; end if;
  end loop;
  return null;
end $$;

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
  select left(coalesce(
    nullif(trim(split_part(
      coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''),
      ',', 1)), ''),
    'anon'), 64);
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
  return json_build_object('ok', true, 'ro', a.ro, 'total', a.total, 'fp', public.aprob_huella(a.items, a.total),
                           'items', a.items, 'decisiones', a.decisiones, 'total_aprobado', a.total_aprobado,
                           'decision', a.decision, 'decidido_at', a.decidido_at, 'nombre', a.nombre);
end $$;

-- ============ PUERTA 2 (vieja, estimado entero): ELIMINADA en v2 ============
-- Nunca estuvo viva (este SQL no se habia corrido). Ahora todo se decide punto por punto (puerta 3);
-- un estimado de un solo trabajo es una lista de un item.
drop function if exists public.aprob_registrar(text, text, text, text);

-- ============ PUERTA 3: el cliente decide PUNTO POR PUNTO ============
-- p_fp = la huella (aprob_huella) que el cliente recibio en la puerta 1. Si cambio algo, no firma.
-- p_decisiones = {"s1":"si","s2":"no"}: TODOS los items de la fila, cada uno "si" o "no", nada inventado.
create or replace function public.aprob_registrar_items(p_token text, p_fp text, p_decisiones jsonb,
                                                        p_nombre text, p_nota text) returns json
language plpgsql security definer set search_path = public as $$
declare a public.aprobaciones%rowtype; v_ip text; v_ua text; it jsonb; v text; mal text;
        n_items int := 0; n_si int := 0; suma numeric(12,2) := 0;
begin
  if p_token is null or length(p_token) < 16 then return json_build_object('ok', false, 'err', 'token'); end if;
  if p_decisiones is null or jsonb_typeof(p_decisiones) <> 'object' then
    return json_build_object('ok', false, 'err', 'decision');
  end if;
  v_ip := public.aprob_ip();
  if not public.aprob_rate_ok('r:' || v_ip, 20, interval '10 minutes') then
    return json_build_object('ok', false, 'err', 'rate');
  end if;
  select * into a from public.aprobaciones where token = p_token for update;
  if not found then return json_build_object('ok', false, 'err', 'no'); end if;
  if a.expira < now() then return json_build_object('ok', false, 'err', 'vencido'); end if;
  if a.decidido_at is not null then
    return json_build_object('ok', true, 'ya', true, 'decision', a.decision, 'decisiones', a.decisiones,
                             'decidido_at', a.decidido_at, 'total_aprobado', a.total_aprobado, 'nombre', a.nombre);
  end if;
  if p_fp is null or public.aprob_huella(a.items, a.total) <> p_fp then
    return json_build_object('ok', false, 'err', 'cambio');
  end if;
  mal := public.aprob_items_mal(a.items);
  if mal is not null then return json_build_object('ok', false, 'err', mal); end if;
  for it in select * from jsonb_array_elements(a.items) loop
    n_items := n_items + 1;
    v := p_decisiones ->> (it ->> 'id');
    if v is null or v not in ('si', 'no') then
      return json_build_object('ok', false, 'err', 'falta', 'id', it ->> 'id');
    end if;
    if v = 'si' then
      n_si := n_si + 1;
      suma := suma + (it ->> 'precio')::numeric;      -- seguro: aprob_items_mal ya reviso el formato
    end if;
  end loop;
  -- los ids son unicos (aprob_items_mal) y todos vinieron: si sobra alguno, es inventado
  if (select count(*) from jsonb_object_keys(p_decisiones)) <> n_items then
    return json_build_object('ok', false, 'err', 'ids');
  end if;
  v_ua := left(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', ''), 200);
  update public.aprobaciones set
    decisiones     = p_decisiones,
    total_aprobado = suma,
    decision       = case when n_si = n_items then 'aprobado' when n_si > 0 then 'parcial' else 'rechazado' end,
    decidido_at    = now(),
    nombre         = left(coalesce(nullif(btrim(p_nombre), ''), '(sin nombre)'), 60),
    nota           = left(coalesce(p_nota, ''), 300),
    ip             = v_ip,
    ua             = v_ua
  where token = p_token;
  select * into a from public.aprobaciones where token = p_token;
  return json_build_object('ok', true, 'decision', a.decision, 'decisiones', a.decisiones,
                           'decidido_at', a.decidido_at, 'total_aprobado', a.total_aprobado, 'nombre', a.nombre);
end $$;

-- solo las dos puertas quedan abiertas al público; el freno de intentos y el validador no
revoke all on function public.aprob_rate_ok(text, int, interval) from public, anon, authenticated;
revoke all on function public.aprob_items_mal(jsonb) from public, anon, authenticated;
revoke all on function public.aprob_huella(jsonb, numeric) from public, anon, authenticated;
revoke all on function public.aprob_ver(text) from public;
revoke all on function public.aprob_registrar_items(text, text, jsonb, text, text) from public;
grant execute on function public.aprob_ver(text) to anon, authenticated;
grant execute on function public.aprob_registrar_items(text, text, jsonb, text, text) to anon, authenticated;

-- ============ REALTIME (el taller se entera al instante) ============
do $$
begin
  alter publication supabase_realtime add table public.aprobaciones;
exception when duplicate_object then null;
end $$;

-- ============ COMPROBACIÓN RÁPIDA ============
-- select public.aprob_ver('0000000000000000');                                   -- {"ok":false,"err":"no"}
-- select public.aprob_registrar_items('0000000000000000','f','{}'::jsonb,'a',''); -- {"ok":false,"err":"no"}
-- select public.aprob_items_mal('[{"id":"a","precio":"1"},{"id":"a","precio":"2"}]'); -- item-id-repetido
