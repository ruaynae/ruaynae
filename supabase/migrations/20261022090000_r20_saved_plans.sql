-- ════════════════════════════════════════════════════════════════════════
-- R20i · บันทึกแผนงานก่อสร้างไว้ในเว็บ + กรอกผลงานรายงวดบนเว็บ
-- ════════════════════════════════════════════════════════════════════════
--
-- หนึ่งแถว = แผนงานหนึ่งฉบับ (หมวด/งาน/รายการจาก BOQ + ลำดับงานที่จัดแล้ว + ผลงานรายงวด)
-- · เก็บเป็น jsonb ทั้งก้อน เพราะแผนถูกอ่าน/เขียนทั้งฉบับเสมอ (ไม่มีใคร query รายการเดี่ยว)
--   และรูปร่างต้องตรงกับ `BoqCategory` ใน `src/lib/boq/core.ts` ที่ตัวสร้าง Excel ใช้
-- · `progress` = { dates: (YYYY-MM-DD|null)[] ยาวเท่า periods,
--                  items: { "<หมวด>.<งาน>.<รายการ>": (0..1|null)[] } }
--   คีย์รายการนับจาก `categories` ทั้งก้อน (รวมงานที่ปิดไว้) — ปิด/เปิดงานแล้วคีย์ไม่เลื่อน
-- · ผูกโครงการได้ ไม่บังคับ · ลบโครงการแล้วแผนงานต้องอยู่ต่อ (on delete set null)
--
-- 🔴 ไม่มีข้อมูลตั้งต้นในไฟล์นี้ — BOQ ของลูกค้าเข้ามาทางหน้า /plans เท่านั้น (repo เป็น public)

create table if not exists public.construction_plans (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 300),
  site_id      uuid references public.sites(id) on delete set null,
  -- ข้อมูลโครงการ/สัญญาบนหัวแผนงาน (ชื่อ เจ้าของ ที่ตั้ง ผู้รับจ้าง เลขที่สัญญา …)
  project      jsonb not null default '{}'::jsonb check (jsonb_typeof(project) = 'object'),
  factor       numeric check (factor is null or factor between 1 and 3),
  vat          numeric check (vat is null or vat between 0 and 1),
  categories   jsonb not null check (jsonb_typeof(categories) = 'array' and jsonb_array_length(categories) between 1 and 200),
  start_date   date not null,
  days         int  not null check (days between 14 and 1500),
  periods      int  not null check (periods between 1 and 24),
  w124         boolean not null default false,
  source_file  text not null default '' check (length(source_file) <= 300),
  progress     jsonb not null default '{"dates":[],"items":{}}'::jsonb check (jsonb_typeof(progress) = 'object'),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- กันไฟล์ใหญ่ผิดปกติ (BOQ จริง ~200 KB) — แถวเดียวโหลดทั้งก้อนทุกครั้งที่เปิดหน้า
  constraint construction_plans_size check (pg_column_size(categories) + pg_column_size(progress) < 4000000)
);
-- ลิสต์: เรียงตามที่แก้ล่าสุด (§7 — หน้า /plans ใช้ order + range)
create index if not exists construction_plans_updated_idx on public.construction_plans(updated_at desc, id desc);
create index if not exists construction_plans_site_idx on public.construction_plans(site_id);
create index if not exists construction_plans_created_by_idx on public.construction_plans(created_by);

-- ── RLS + audit — เจ้าของเท่านั้น (ค่างานต้นทุนทุกหมวด เหมือนเมนู /plans) ─────────
alter table public.construction_plans enable row level security;

drop policy if exists construction_plans_owner_select on public.construction_plans;
create policy construction_plans_owner_select on public.construction_plans for select to authenticated
  using ((select public.is_owner()));
drop policy if exists construction_plans_owner_insert on public.construction_plans;
create policy construction_plans_owner_insert on public.construction_plans for insert to authenticated
  with check ((select public.is_owner()));
drop policy if exists construction_plans_owner_update on public.construction_plans;
create policy construction_plans_owner_update on public.construction_plans for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists construction_plans_owner_delete on public.construction_plans;
create policy construction_plans_owner_delete on public.construction_plans for delete to authenticated
  using ((select public.is_owner()));

drop trigger if exists construction_plans_audit on public.construction_plans;
create trigger construction_plans_audit after insert or update or delete on public.construction_plans
  for each row execute function public.audit_row();

drop trigger if exists construction_plans_set_updated_at on public.construction_plans;
create trigger construction_plans_set_updated_at before update on public.construction_plans
  for each row execute function public.set_updated_at();

comment on table public.construction_plans is
  'R20i · แผนงานก่อสร้างที่บันทึกไว้ (BOQ + ลำดับงาน) และผลงานรายงวดที่กรอกบนเว็บ — เจ้าของเท่านั้น';
