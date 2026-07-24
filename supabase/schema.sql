-- ShopFlow — sincronización multi-dispositivo (Supabase)
-- v1: un "taller" = una cuenta (auth user) = una fila con TODA la base de datos en jsonb,
-- con Realtime para que 2+ dispositivos vean los cambios al instante. Offline-first: la app
-- sigue usando localStorage como caché; Supabase es la fuente de verdad cuando hay señal.
-- Pegar TODO esto en Supabase → SQL Editor → Run.

-- ============ TABLA PRINCIPAL ============
create table if not exists public.shops (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users(id) on delete cascade,
  name        text,
  data        jsonb not null default '{}'::jsonb,   -- el DB completo de ShopFlow (ordenes, clientes, citas, etc.)
  rev         bigint not null default 0,            -- sube +1 en cada guardado; ayuda a detectar quién está viejo
  updated_at  timestamptz not null default now(),
  updated_by  text                                   -- etiqueta del dispositivo que guardó (ej: "iPad taller")
);

-- un solo taller por cuenta (por ahora); relaja esto si un dueño maneja varios talleres
create unique index if not exists shops_owner_uniq on public.shops(owner);

-- ============ SEGURIDAD (RLS) — cada quien solo ve SU taller ============
alter table public.shops enable row level security;

drop policy if exists "shop_select" on public.shops;
create policy "shop_select" on public.shops
  for select using (auth.uid() = owner);

drop policy if exists "shop_insert" on public.shops;
create policy "shop_insert" on public.shops
  for insert with check (auth.uid() = owner);

drop policy if exists "shop_update" on public.shops;
create policy "shop_update" on public.shops
  for update using (auth.uid() = owner) with check (auth.uid() = owner);

-- ============ REALTIME — empuja cambios a los otros dispositivos ============
alter publication supabase_realtime add table public.shops;

-- ============ updated_at automático ============
create or replace function public.touch_shop() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists shops_touch on public.shops;
create trigger shops_touch before update on public.shops
  for each row execute function public.touch_shop();
