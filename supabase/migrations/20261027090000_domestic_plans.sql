-- ════════════════════════════════════════════════════════════════════════
-- R22b · บันทึกแผนการใช้พัสดุ/เหล็กที่ผลิตภายในประเทศไว้ในเว็บ (คำขอเจ้าของ 27 ต.ค. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- หนึ่งแถว = ตารางพัสดุหนึ่งฉบับที่อ่านจาก BOQ + ที่เจ้าของติ๊ก "เหล็ก"/"นำเข้า" ไว้
-- · `model` = `DomModel` ใน `src/lib/boq/domestic.ts` ทั้งก้อน ({ project, sheets: [{ sheet, rows }] })
--   ธง steel/foreign อยู่บนแถวรายการเลย — เปิดกลับมาไม่ต้องอัปโหลด BOQ ซ้ำ
-- · ผูกโครงการได้ ไม่บังคับ · ลบโครงการแล้วแผนต้องอยู่ต่อ (on delete set null)
--
-- 🔴 ไม่มีข้อมูลตั้งต้นในไฟล์นี้ — BOQ ของลูกค้าเข้ามาทางหน้า /plans เท่านั้น (repo เป็น public)

create table if not exists public.domestic_plans (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 300),
  site_id      uuid references public.sites(id) on delete set null,
  model        jsonb not null check (jsonb_typeof(model) = 'object' and jsonb_typeof(model->'sheets') = 'array'),
  source_file  text not null default '' check (length(source_file) <= 300),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint domestic_plans_size check (pg_column_size(model) < 4000000)
);
create index if not exists domestic_plans_updated_idx on public.domestic_plans(updated_at desc, id desc);
create index if not exists domestic_plans_site_idx on public.domestic_plans(site_id);
create index if not exists domestic_plans_created_by_idx on public.domestic_plans(created_by);

-- ── RLS + audit — เจ้าของเท่านั้น (ค่าวัสดุทุกรายการ เหมือนเมนู /plans) ─────────
alter table public.domestic_plans enable row level security;

drop policy if exists domestic_plans_owner_select on public.domestic_plans;
create policy domestic_plans_owner_select on public.domestic_plans for select to authenticated
  using ((select public.is_owner()));
drop policy if exists domestic_plans_owner_insert on public.domestic_plans;
create policy domestic_plans_owner_insert on public.domestic_plans for insert to authenticated
  with check ((select public.is_owner()));
drop policy if exists domestic_plans_owner_update on public.domestic_plans;
create policy domestic_plans_owner_update on public.domestic_plans for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists domestic_plans_owner_delete on public.domestic_plans;
create policy domestic_plans_owner_delete on public.domestic_plans for delete to authenticated
  using ((select public.is_owner()));

drop trigger if exists domestic_plans_audit on public.domestic_plans;
create trigger domestic_plans_audit after insert or update or delete on public.domestic_plans
  for each row execute function public.audit_row();

drop trigger if exists domestic_plans_set_updated_at on public.domestic_plans;
create trigger domestic_plans_set_updated_at before update on public.domestic_plans
  for each row execute function public.set_updated_at();

comment on table public.domestic_plans is
  'R22b · แผนการใช้พัสดุ/เหล็กที่ผลิตภายในประเทศที่บันทึกไว้ (ตารางจาก BOQ + ธงเหล็ก/นำเข้า) — เจ้าของเท่านั้น';
