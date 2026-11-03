-- ════════════════════════════════════════════════════════════════════════
-- R27 · คลังวัสดุขออนุมัติ — เก็บแค็ตตาล็อกวัสดุที่ใช้ประจำ แล้วเลือกเข้าหนังสือขออนุมัติใช้วัสดุ
-- (คำขอเจ้าของ 3 พ.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- 1 แถว `material_catalog` = วัสดุ 1 รายการ (ชื่อ · หมวด · รายละเอียดที่ขออนุมัติ · หมายเหตุ)
-- `material_catalog_pages` = หน้าแค็ตตาล็อกของวัสดุนั้น (ไฟล์อยู่ R2 `catalog/<uuid>.<ext>`) เรียงตาม seq
-- `material_library_settings` = แถวเดียว: รูปตราประทับบริษัท (ระบบประทับลงหน้าแค็ตตาล็อกตอนแนบ)
--
-- 🔴 หนังสือ **อ้างอิงไฟล์ในคลังโดยตรง ไม่คัดลอก** (ประหยัดพื้นที่ R2) → `letter_photos.object_key` ชี้ `catalog/…` ได้
--    · เลยต้องถอด unique ของ object_key เดิม (หนังสือหลายฉบับใช้หน้าเดียวกันได้) แล้วคง unique เฉพาะ `letters/…`
--    · ขยายเพดานรูปแนบ 12 → 60 (แค็ตตาล็อกของหนังสือเดียวเกิน 12 หน้าแล้ว)
--    · เพิ่ม `stamped` (ประทับตราหน้านี้) และเลย์เอาต์ `p` = 1 หน้ากระดาษต่อ 1 รูป
--    · ลบหน้าแค็ตตาล็อกที่ยังมีหนังสืออ้างอยู่ไม่ได้ (`CATALOG_IN_USE`) — ซ่อนวัสดุแทน (`is_active = false`)
-- · เจ้าของเท่านั้น เหมือน `letters`
--
-- ตรวจหลัง apply (CLAUDE.md §17 ข้อ 21 — ชื่อ constraint ที่ Postgres ตั้งเองต้องเห็นกับตา):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid in ('public.letter_photos'::regclass, 'public.letters'::regclass) and contype in ('c','u') order by 1;

create table if not exists public.material_catalog (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 1 and 200),
  category   text not null default '' check (length(category) <= 60),
  detail     text not null default '' check (length(detail) <= 300),
  note       text not null default '' check (length(note) <= 300),
  is_active  boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists material_catalog_name_idx on public.material_catalog(is_active, name);
create index if not exists material_catalog_created_by_idx on public.material_catalog(created_by);

create table if not exists public.material_catalog_pages (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.material_catalog(id) on delete cascade,
  seq        int  not null check (seq between 1 and 999),
  object_key text not null unique check (object_key like 'catalog/%'),
  byte_size  int  not null default 0 check (byte_size >= 0),
  created_at timestamptz not null default now(),
  constraint material_catalog_pages_seq_uniq unique (item_id, seq)
);
create index if not exists material_catalog_pages_item_idx on public.material_catalog_pages(item_id, seq);

create table if not exists public.material_library_settings (
  id               boolean primary key default true check (id),
  stamp_object_key text check (stamp_object_key is null or stamp_object_key like 'catalog/%'),
  updated_at       timestamptz not null default now()
);
insert into public.material_library_settings (id) values (true) on conflict do nothing;

alter table public.material_catalog enable row level security;
alter table public.material_catalog_pages enable row level security;
alter table public.material_library_settings enable row level security;

do $$
declare t text;
begin
  foreach t in array array['material_catalog', 'material_catalog_pages', 'material_library_settings'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_owner()))', t || '_owner_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_owner()))', t || '_owner_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_update', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t || '_owner_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select public.is_owner()))', t || '_owner_delete', t);
  end loop;
end $$;

-- audit: ไม่ติดกับ material_library_settings (คีย์เป็น boolean ไม่ใช่ uuid — กลัว audit_row cast พัง = หยุดการเขียนทั้งก้อน §17 ข้อ 19)
drop trigger if exists material_catalog_audit on public.material_catalog;
create trigger material_catalog_audit after insert or update or delete on public.material_catalog
  for each row execute function public.audit_row();
drop trigger if exists material_catalog_pages_audit on public.material_catalog_pages;
create trigger material_catalog_pages_audit after insert or update or delete on public.material_catalog_pages
  for each row execute function public.audit_row();

drop trigger if exists material_catalog_set_updated_at on public.material_catalog;
create trigger material_catalog_set_updated_at before update on public.material_catalog
  for each row execute function public.set_updated_at();
drop trigger if exists material_library_settings_set_updated_at on public.material_library_settings;
create trigger material_library_settings_set_updated_at before update on public.material_library_settings
  for each row execute function public.set_updated_at();

-- หน้าแค็ตตาล็อกที่หนังสือยังอ้างอยู่ ลบไม่ได้ — รวมตอนลบทั้งวัสดุ (cascade ยิง trigger นี้ทีละหน้า → ทั้งคำสั่งล้ม)
create or replace function public.guard_catalog_page_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.letter_photos where object_key = old.object_key) then
    raise exception 'CATALOG_IN_USE: มีหนังสือใช้หน้าแค็ตตาล็อกนี้อยู่ — ซ่อนวัสดุแทนการลบ';
  end if;
  return old;
end;
$$;
drop trigger if exists material_catalog_pages_guard_delete on public.material_catalog_pages;
create trigger material_catalog_pages_guard_delete before delete on public.material_catalog_pages
  for each row execute function public.guard_catalog_page_delete();

-- ── letter_photos: อ้างอิงไฟล์ในคลังได้ · 60 หน้า · ประทับตรา ────────────────────────
-- ถอด check/unique ที่ Postgres ตั้งชื่อเอง โดยหาจากนิยาม (ไม่เดาชื่อ)
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.letter_photos'::regclass
      and (
        (c.contype = 'c' and (pg_get_constraintdef(c.oid) ~ '\mseq\M' or pg_get_constraintdef(c.oid) ~ 'object_key'))
        or (c.contype = 'u' and c.conkey = array[(
          select a.attnum from pg_attribute a where a.attrelid = 'public.letter_photos'::regclass and a.attname = 'object_key'
        )])
      )
  loop
    execute format('alter table public.letter_photos drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.letter_photos
  add constraint letter_photos_seq_range check (seq between 1 and 999),
  add constraint letter_photos_key_prefix check (object_key like 'letters/%' or object_key like 'catalog/%');
create unique index if not exists letter_photos_letters_key_uniq on public.letter_photos(object_key) where object_key like 'letters/%';
create index if not exists letter_photos_key_idx on public.letter_photos(object_key);
alter table public.letter_photos add column if not exists stamped boolean not null default false;

do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.letters'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ 'photo_layout'
  loop
    execute format('alter table public.letters drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.letters add constraint letters_photo_layout_check check (photo_layout in ('1', '2', 'p'));

comment on table public.material_catalog is
  'คลังวัสดุขออนุมัติ (R27) — ชื่อ/รายละเอียดที่ใช้ขออนุมัติ · หน้าแค็ตตาล็อกอยู่ material_catalog_pages · เจ้าของเท่านั้น';
comment on table public.material_catalog_pages is
  'หน้าแค็ตตาล็อกของวัสดุ (ไฟล์อยู่ R2 catalog/…) · หนังสืออ้างอิงตรง ๆ ลบไม่ได้ถ้ายังมีหนังสือใช้';
comment on table public.material_library_settings is
  'แถวเดียว: รูปตราประทับบริษัทที่ระบบประทับลงหน้าแค็ตตาล็อก (R27)';
