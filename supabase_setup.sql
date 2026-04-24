
-- Run this in Supabase SQL editor

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists order_type text default 'onhand',
  add column if not exists tracked_items jsonb default '[]'::jsonb;

update public.orders
set order_type = case
  when lower(coalesce(delivery_method,'')) = 'mto' then 'mto'
  else coalesce(order_type, 'onhand')
end
where order_type is null or order_type = '';

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  product_name text not null,
  variant text not null,
  size text not null,
  sku text,
  on_hand_qty integer not null default 0,
  production_qty integer not null default 0,
  reserved_qty integer not null default 0,
  low_stock_alert integer not null default 10,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_inventory_items_updated_at on public.inventory_items;
create trigger trg_inventory_items_updated_at
before update on public.inventory_items
for each row execute procedure public.set_updated_at();

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  description text,
  user_email text,
  created_at timestamptz not null default now()
);

alter table public.inventory_items enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "inventory read" on public.inventory_items;
create policy "inventory read" on public.inventory_items for select using (auth.role() = 'authenticated');
drop policy if exists "inventory write" on public.inventory_items;
create policy "inventory write" on public.inventory_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "activity read" on public.activity_logs;
create policy "activity read" on public.activity_logs for select using (auth.role() = 'authenticated');
drop policy if exists "activity write" on public.activity_logs;
create policy "activity write" on public.activity_logs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
