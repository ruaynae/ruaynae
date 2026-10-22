-- ════════════════════════════════════════════════════════════════════════
-- คลังเอกสาร — สัญญาจ้าง · แบบก่อสร้าง · BOQ · หนังสือรับรองผลงาน (คำขอเจ้าของ 22 ต.ค. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- หนึ่งแถว = ไฟล์หนึ่งไฟล์ใน R2 (`files/<uuid>.<ext>`) · ผูกโครงการได้ ไม่บังคับ
-- · เก็บแค่ `object_key` ไม่เก็บ URL (§9) · เปิดไฟล์ผ่าน `/api/files/[id]` ที่เช็คสิทธิ์แล้ว 302 ไป presigned GET
-- · อัปโหลดผ่าน `upload_intents` เดิม (thumb_key = object_key) → ไฟล์ที่อัปแล้วไม่ได้บันทึกถูก sweep-orphans กวาด
-- · เจ้าของเท่านั้น — สัญญาและ BOQ มีค่างาน/ราคากลางทั้งก้อน (เหมือน site_finance)
-- · ลบโครงการแล้วเอกสารต้องอยู่ต่อ (on delete set null) — หนังสือรับรองผลงานใช้ยื่นงานใหม่อีกหลายปี

create table if not exists public.project_files (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid references public.sites(id) on delete set null,
  category     text not null check (category in ('contract', 'drawing', 'boq', 'certificate', 'other')),
  title        text not null check (length(btrim(title)) between 1 and 300),
  doc_no       text check (doc_no is null or length(doc_no) <= 100),
  doc_date     date check (doc_date is null or doc_date between '1900-01-01' and '2200-12-31'),
  note         text check (note is null or length(note) <= 2000),
  file_name    text not null check (length(file_name) between 1 and 300),
  object_key   text not null unique check (object_key like 'files/%'),
  content_type text not null check (length(content_type) <= 200),
  byte_size    bigint not null check (byte_size >= 0),
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists project_files_recent_idx on public.project_files(created_at desc, id desc);
create index if not exists project_files_site_idx on public.project_files(site_id, created_at desc);
create index if not exists project_files_category_idx on public.project_files(category, created_at desc);
create index if not exists project_files_created_by_idx on public.project_files(created_by);

alter table public.project_files enable row level security;

drop policy if exists project_files_owner_select on public.project_files;
create policy project_files_owner_select on public.project_files for select to authenticated
  using ((select public.is_owner()));
drop policy if exists project_files_owner_insert on public.project_files;
create policy project_files_owner_insert on public.project_files for insert to authenticated
  with check ((select public.is_owner()));
drop policy if exists project_files_owner_update on public.project_files;
create policy project_files_owner_update on public.project_files for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists project_files_owner_delete on public.project_files;
create policy project_files_owner_delete on public.project_files for delete to authenticated
  using ((select public.is_owner()));

-- ไฟล์ที่ชี้อยู่ห้ามเปลี่ยน — แก้ได้แค่ข้อมูลประกอบ (ชื่อ หมวด โครงการ เลขที่ วันที่ หมายเหตุ)
create or replace function public.guard_project_file()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.object_key is distinct from old.object_key
     or new.byte_size is distinct from old.byte_size
     or new.content_type is distinct from old.content_type
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'FILE_IMMUTABLE: เปลี่ยนไฟล์ไม่ได้ ให้อัปโหลดใหม่แล้วลบไฟล์เดิม';
  end if;
  return new;
end;
$$;

drop trigger if exists project_files_guard on public.project_files;
create trigger project_files_guard before update on public.project_files
  for each row execute function public.guard_project_file();

drop trigger if exists project_files_audit on public.project_files;
create trigger project_files_audit after insert or update or delete on public.project_files
  for each row execute function public.audit_row();

drop trigger if exists project_files_set_updated_at on public.project_files;
create trigger project_files_set_updated_at before update on public.project_files
  for each row execute function public.set_updated_at();

comment on table public.project_files is
  'คลังเอกสาร — สัญญาจ้าง แบบก่อสร้าง BOQ หนังสือรับรองผลงาน (ไฟล์อยู่ R2 files/…) · เจ้าของเท่านั้น';
