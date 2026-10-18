-- R18 · M0 — เชื่อม Loyverse: โทเคนใน Vault + สำเนารายการสินค้า (pos_items) + ค่าตั้งร้าน (pos_settings)
-- แผน: docs/test-plan/R18-loyverse-withdrawals.md
--
-- 🔴 Loyverse คือแหล่งความจริงของสินค้า/สต็อก · ตารางนี้เป็นสำเนาที่ระบบดึงมา
--    คอลัมน์สำเนา (ชื่อ ทุน ราคา คงเหลือ ฯลฯ) เขียนได้เฉพาะตัวซิงก์ (`pos_items_sync`)
--    เจ้าของแก้ได้แค่ `cost_override` (ทุนที่เติมเอง) กับ `reorder_point` (จุดเตือนของเรา)
-- 🔴 โทเคนอยู่ใน Vault เหมือนคีย์ LINE (R16) · ไม่ส่งกลับเป็นข้อความจริงที่ไหนเลย — โชว์แค่ 4 ตัวท้าย

-- ── 1 · ค่าตั้งร้าน (แถวเดียว) ──────────────────────────────────────────
create table if not exists public.pos_settings (
  id                           boolean primary key default true check (id),
  store_id                     text,
  store_name                   text,
  withdraw_payment_type_id     text,          -- วิธีชำระเงิน "เบิกใช้งาน" ใน Loyverse
  withdraw_payment_type_name   text,
  items_synced_at              timestamptz,
  updated_at                   timestamptz not null default now()
);
insert into public.pos_settings (id) values (true) on conflict do nothing;

-- ── 2 · สำเนารายการสินค้า (หนึ่งแถว = หนึ่ง variant ของ Loyverse) ───────────
create table if not exists public.pos_items (
  variant_id      text primary key,
  item_id         text not null,
  sku             text,
  name            text not null,
  variant_name    text,
  category        text,
  barcode         text,
  pos_cost        numeric(14,2),                 -- ทุนใน Loyverse · 0 = ยังไม่ได้ตั้ง
  price           numeric(14,2),                 -- ราคาขายของร้านที่เลือก
  track_stock     boolean not null default false,
  in_stock        numeric(14,3),                 -- null = ไม่ติดตามสต็อก
  pos_low_stock   numeric(14,3),
  is_active       boolean not null default true, -- false = หายไปจาก Loyverse แล้ว (ไม่ลบ เพราะบิลเก่ายังอ้างถึง)
  cost_override   numeric(14,2) check (cost_override is null or cost_override >= 0),
  reorder_point   numeric(14,3) check (reorder_point is null or reorder_point >= 0),
  synced_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists pos_items_sku_idx on public.pos_items (sku);
create index if not exists pos_items_barcode_idx on public.pos_items (barcode) where barcode is not null;
create index if not exists pos_items_name_idx on public.pos_items (name);

alter table public.pos_settings enable row level security;
alter table public.pos_items    enable row level security;

drop policy if exists pos_settings_owner_select on public.pos_settings;
create policy pos_settings_owner_select on public.pos_settings for select to authenticated
  using ((select public.is_owner()));
drop policy if exists pos_settings_owner_update on public.pos_settings;
create policy pos_settings_owner_update on public.pos_settings for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- หัวหน้าโครงการจะได้มุมมองแบบไม่มีทุนใน M1 (view แยก) · ตอนนี้เจ้าของเท่านั้น
drop policy if exists pos_items_owner_select on public.pos_items;
create policy pos_items_owner_select on public.pos_items for select to authenticated
  using ((select public.is_owner()));
drop policy if exists pos_items_owner_update on public.pos_items;
create policy pos_items_owner_update on public.pos_items for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
-- ไม่มี policy insert/delete — แถวเกิดจากตัวซิงก์เท่านั้น

-- เจ้าของแก้ได้แค่สองช่อง · ช่องสำเนาดันค่าเดิมกลับ (ตัวซิงก์ตั้ง GUC app.pos_sync เอง)
create or replace function public.guard_pos_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.pos_sync', true), '') <> '1' then
    new.variant_id    := old.variant_id;
    new.item_id       := old.item_id;
    new.sku           := old.sku;
    new.name          := old.name;
    new.variant_name  := old.variant_name;
    new.category      := old.category;
    new.barcode       := old.barcode;
    new.pos_cost      := old.pos_cost;
    new.price         := old.price;
    new.track_stock   := old.track_stock;
    new.in_stock      := old.in_stock;
    new.pos_low_stock := old.pos_low_stock;
    new.is_active     := old.is_active;
    new.synced_at     := old.synced_at;
  end if;
  return new;
end $$;
drop trigger if exists pos_items_guard on public.pos_items;
create trigger pos_items_guard before update on public.pos_items
  for each row execute function public.guard_pos_item();

do $$
declare t text;
begin
  foreach t in array array['pos_settings', 'pos_items'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                      for each row execute function public.audit_row()', t, t);
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I
                      for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ── 3 · ซิงก์รายการสินค้า (service role เท่านั้น) ────────────────────────
-- p_rows = รายการสินค้าทั้งหมดของร้าน (ครบทุกหน้าแล้ว) · แถวที่ไม่อยู่ในรายการ = is_active false
-- 🔴 เขียนเฉพาะแถวที่ค่าเปลี่ยนจริง — ไม่งั้น audit_log บวมเท่าจำนวนสินค้าทุกครั้งที่กดซิงก์
create or replace function public.pos_items_sync(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ins int := 0;
  v_upd int := 0;
  v_off int := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'pos_rows_invalid';
  end if;
  perform set_config('app.pos_sync', '1', true);

  drop table if exists pg_temp._in;
  create temp table _in on commit drop as
  select * from jsonb_to_recordset(p_rows) as r(
    variant_id text, item_id text, sku text, name text, variant_name text, category text,
    barcode text, pos_cost numeric, price numeric, track_stock boolean, in_stock numeric,
    pos_low_stock numeric)
  where r.variant_id is not null and r.item_id is not null and r.name is not null;

  with ins as (
    insert into public.pos_items as p (variant_id, item_id, sku, name, variant_name, category, barcode,
                                       pos_cost, price, track_stock, in_stock, pos_low_stock, is_active, synced_at)
    select i.variant_id, i.item_id, i.sku, i.name, i.variant_name, i.category, i.barcode,
           i.pos_cost, i.price, coalesce(i.track_stock, false), i.in_stock, i.pos_low_stock, true, now()
    from pg_temp._in i
    where not exists (select 1 from public.pos_items x where x.variant_id = i.variant_id)
    returning 1
  ) select count(*) into v_ins from ins;

  with upd as (
    update public.pos_items p set
      item_id = i.item_id, sku = i.sku, name = i.name, variant_name = i.variant_name,
      category = i.category, barcode = i.barcode, pos_cost = i.pos_cost, price = i.price,
      track_stock = coalesce(i.track_stock, false), in_stock = i.in_stock,
      pos_low_stock = i.pos_low_stock, is_active = true, synced_at = now()
    from pg_temp._in i
    where p.variant_id = i.variant_id
      and (p.item_id, p.sku, p.name, p.variant_name, p.category, p.barcode, p.pos_cost, p.price,
           p.track_stock, p.in_stock, p.pos_low_stock, p.is_active)
          is distinct from
          (i.item_id, i.sku, i.name, i.variant_name, i.category, i.barcode, i.pos_cost, i.price,
           coalesce(i.track_stock, false), i.in_stock, i.pos_low_stock, true)
    returning 1
  ) select count(*) into v_upd from upd;

  with off as (
    update public.pos_items p set is_active = false, synced_at = now()
    where p.is_active and not exists (select 1 from pg_temp._in i where i.variant_id = p.variant_id)
    returning 1
  ) select count(*) into v_off from off;

  update public.pos_settings set items_synced_at = now() where id;

  return jsonb_build_object(
    'received', (select count(*) from pg_temp._in),
    'inserted', v_ins, 'updated', v_upd, 'deactivated', v_off,
    'active', (select count(*) from public.pos_items where is_active),
    'cost_missing', (select count(*) from public.pos_items
                      where is_active and coalesce(pos_cost, 0) = 0 and cost_override is null),
    'negative_stock', (select count(*) from public.pos_items
                        where is_active and track_stock and in_stock < 0));
end $$;
revoke execute on function public.pos_items_sync(jsonb) from public, anon, authenticated;
grant  execute on function public.pos_items_sync(jsonb) to service_role;

-- ── 4 · โทเคน Loyverse ใน Vault ────────────────────────────────────────
create or replace function public.set_loyverse_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := nullif(btrim(coalesce(p_token, '')), '');
  v_id    uuid;
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_token is null or length(v_token) not between 16 and 400 or v_token ~ '\s' then
    raise exception 'loyverse_token_invalid';
  end if;
  select id into v_id from vault.secrets where name = 'loyverse_access_token';
  if v_id is null then
    perform vault.create_secret(v_token, 'loyverse_access_token', 'Loyverse API access token');
  else
    perform vault.update_secret(v_id, v_token);
  end if;
  -- ร่องรอยว่าใครเปลี่ยนโทเคนตอนไหน · ไม่มีค่าโทเคนเด็ดขาด
  insert into public.audit_log(table_name, row_id, action, actor, before, after)
  values ('loyverse_token', null, 'UPDATE', auth.uid(), null, jsonb_build_object('changed', true));
end $$;
revoke execute on function public.set_loyverse_token(text) from public, anon;
grant  execute on function public.set_loyverse_token(text) to authenticated;

create or replace function public.loyverse_token_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v text;
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = 'loyverse_access_token';
  return jsonb_build_object('set', v is not null, 'last4', case when v is null then null else right(v, 4) end);
end $$;
revoke execute on function public.loyverse_token_status() from public, anon;
grant  execute on function public.loyverse_token_status() to authenticated;

-- ตัวอ่านโทเคนจริง — เฉพาะเซิร์ฟเวอร์ (service_role) · ห้ามให้ authenticated เด็ดขาด
create or replace function public._loyverse_token()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'loyverse_access_token'
$$;
revoke execute on function public._loyverse_token() from public, anon, authenticated;
grant  execute on function public._loyverse_token() to service_role;
