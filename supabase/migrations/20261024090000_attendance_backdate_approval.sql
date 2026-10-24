-- ลงชื่อคนเข้าโครงการย้อนหลัง — หัวหน้าโครงการทำเองไม่ได้ ต้องยื่นให้เจ้าของอนุมัติ
-- (คำสั่งเจ้าของ 24 ต.ค. 2569)
--
-- "ย้อนหลัง" = `work_date` ก่อนวันนี้ตามเวลาไทย · ครอบคลุม **เพิ่ม · แก้ · ลบ** แถว attendance
-- ทั้งหมด (ลบแถวเมื่อวานทิ้งก็คือการแก้ค่าแรงย้อนหลังเหมือนกัน)
--
-- 🔴 ด่านอยู่ที่ trigger ไม่ใช่ที่ route — เส้นทางไหนที่ลืมใส่จะเป็นรูโดยไม่มี error
--    เจ้าของ (is_owner) และงานที่รันเป็น superuser/service (auth.uid() is null) ผ่านเสมอ
--    · MCP/LINE สวมสิทธิ์เจ้าของจริง ๆ จึงผ่านเหมือนกัน
--
-- เส้นทางอนุมัติ: หัวหน้ายื่นคำขอ → เจ้าของกดอนุมัติ → RPC เขียนแถว attendance ในนามเจ้าของ
-- (guard เดิมทุกตัวยังทำงานครบ: เพดาน 1 วันต่อคน · ปิดรอบจ่ายแล้วห้ามแตะ)
--
-- ค่า enum ใหม่เพิ่มบนหัวไฟล์นี้และ **ไม่ถูกใช้ในไฟล์นี้** (ใช้ตอนรัน RPC เท่านั้น) จึงรันไฟล์เดียวได้

alter type public.notification_kind add value if not exists 'backdate_pending';
alter type public.notification_kind add value if not exists 'backdate_approved';
alter type public.notification_kind add value if not exists 'backdate_rejected';

-- ── 1 · ด่านที่ attendance ───────────────────────────────────────────
create or replace function public.guard_attendance_backdate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  -- สคริปต์/service role (ไม่มีผู้ใช้) และเจ้าของไม่ถูกจำกัด
  if auth.uid() is null or (select public.is_owner()) then
    return coalesce(new, old);
  end if;

  -- ดูทั้งวันเดิมและวันใหม่ — แก้วันที่ของแถววันนี้ให้ถอยหลังก็คือการลงย้อนหลัง
  if (tg_op in ('UPDATE', 'DELETE') and old.work_date < v_today)
     or (tg_op in ('INSERT', 'UPDATE') and new.work_date < v_today) then
    raise exception 'BACKDATE_NEEDS_APPROVAL: ลงชื่อ/แก้ไข/ลบย้อนหลังเองไม่ได้ — ต้องยื่นคำขอให้เจ้าของอนุมัติก่อน';
  end if;

  return coalesce(new, old);
end $$;

drop trigger if exists attendance_backdate_guard on public.attendance;
create trigger attendance_backdate_guard
  before insert or update or delete on public.attendance
  for each row execute function public.guard_attendance_backdate();

revoke execute on function public.guard_attendance_backdate() from public, anon, authenticated;

-- ── 2 · คำขอลงชื่อย้อนหลัง ───────────────────────────────────────────
create table if not exists public.attendance_backdate_requests (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites(id) on delete cascade,
  employee_id     uuid not null references public.employees(id) on delete cascade,
  work_date       date not null,
  work_units      numeric(2,1) not null check (work_units in (0.5, 1)),
  reason          text not null check (char_length(btrim(reason)) between 1 and 500),
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  rejected_reason text check (rejected_reason is null or char_length(rejected_reason) <= 500),
  requested_by    uuid not null references public.profiles(id),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  attendance_id   uuid,            -- แถวที่ถูกสร้างตอนอนุมัติ · ไม่มี FK (แถวนั้นอาจถูกลบทีหลัง)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- คนเดียวกัน โครงการเดียวกัน วันเดียวกัน ยื่นค้างได้ใบเดียว
create unique index if not exists attendance_backdate_pending_uniq
  on public.attendance_backdate_requests (site_id, employee_id, work_date)
  where status = 'pending';
create index if not exists attendance_backdate_status_idx
  on public.attendance_backdate_requests (status, created_at);
create index if not exists attendance_backdate_requester_idx
  on public.attendance_backdate_requests (requested_by, created_at desc);
create index if not exists attendance_backdate_employee_idx
  on public.attendance_backdate_requests (employee_id);
create index if not exists attendance_backdate_site_idx
  on public.attendance_backdate_requests (site_id, work_date);

alter table public.attendance_backdate_requests enable row level security;

-- เจ้าของเห็นทุกใบ · หัวหน้าเห็นเฉพาะใบที่ตัวเองยื่น · ไม่มี policy เขียน — เขียนผ่าน RPC เท่านั้น
drop policy if exists attendance_backdate_select on public.attendance_backdate_requests;
create policy attendance_backdate_select on public.attendance_backdate_requests
  for select to authenticated
  using ((select public.is_owner()) or requested_by = (select auth.uid()));

drop trigger if exists attendance_backdate_set_updated_at on public.attendance_backdate_requests;
create trigger attendance_backdate_set_updated_at before update on public.attendance_backdate_requests
  for each row execute function public.set_updated_at();
drop trigger if exists attendance_backdate_audit on public.attendance_backdate_requests;
create trigger attendance_backdate_audit after insert or update or delete on public.attendance_backdate_requests
  for each row execute function public.audit_row();

-- ── 3 · ยื่นคำขอ (หัวหน้าโครงการ) ────────────────────────────────────
create or replace function public.attendance_backdate_request(
  p_site     uuid,
  p_employee uuid,
  p_date     date,
  p_units    numeric,
  p_reason   text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_emp   public.employees%rowtype;
  v_id    uuid;
  v_who   text;
  v_site  text;
  v_have  numeric;
begin
  if v_uid is null or not (select public.is_supervisor()) then
    raise exception 'FORBIDDEN: เฉพาะหัวหน้าโครงการเท่านั้นที่ยื่นคำขอลงชื่อย้อนหลัง (เจ้าของลงชื่อได้ตรง ๆ)';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.is_active) then
    raise exception 'FORBIDDEN: บัญชีนี้ถูกปิดใช้งาน';
  end if;
  if p_date is null or p_date >= v_today then
    raise exception 'DATE_NOT_PAST: วันนี้ลงชื่อได้เลย ไม่ต้องยื่นคำขอ';
  end if;
  if extract(year from p_date) > 2200 then
    raise exception 'DATE_BUDDHIST_ERA: ปีที่กรอกเป็น พ.ศ.';
  end if;
  if p_units is null or p_units not in (0.5, 1) then
    raise exception 'WORK_UNITS_INVALID: ลงได้เฉพาะเต็มวันหรือครึ่งวัน';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED: กรุณาบอกเหตุผลที่ต้องลงย้อนหลัง';
  end if;
  -- ขอบเขตโครงการนับ ณ วันที่ขอลง (ไม่ใช่วันนี้) — เหมือน policy ของ attendance
  if not public.supervises_site(p_site, p_date) then
    raise exception 'FORBIDDEN: คุณไม่ได้ดูแลโครงการนี้ในวันที่เลือก';
  end if;

  select * into v_emp from public.employees e where e.id = p_employee;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;
  if not v_emp.is_active then
    raise exception 'EMPLOYEE_INACTIVE: คนงานคนนี้ถูกปิดใช้งานแล้ว';
  end if;

  -- เตือนล่วงหน้าไม่ให้ยื่นของที่ยังไงก็อนุมัติไม่ผ่าน (ตัวตัดสินจริงคือ guard ตอนอนุมัติ)
  if exists (select 1 from public.attendance a
              where a.employee_id = p_employee and a.work_date = p_date and a.site_id = p_site) then
    raise exception 'ALREADY_SIGNED_IN: คนนี้ถูกลงชื่อในโครงการนี้ของวันนั้นไปแล้ว';
  end if;
  select coalesce(sum(a.work_units), 0) into v_have
    from public.attendance a where a.employee_id = p_employee and a.work_date = p_date;
  if v_have + p_units > 1 then
    raise exception 'WORK_UNITS_EXCEEDED: วันนั้นคนนี้ถูกลงชื่อที่โครงการอื่นไปแล้ว รวมกันจะเกินหนึ่งวัน';
  end if;
  if public.attendance_paid(p_employee, p_date, p_site) then
    raise exception 'PAYROLL_CLOSED: วันนั้นถูกจ่ายค่าแรงไปแล้ว แก้ไม่ได้';
  end if;

  begin
    insert into public.attendance_backdate_requests
      (site_id, employee_id, work_date, work_units, reason, requested_by)
    values (p_site, p_employee, p_date, p_units, btrim(p_reason), v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'REQUEST_DUPLICATE: มีคำขอของคนนี้ในวันนั้นรออนุมัติอยู่แล้ว';
  end;

  select s.name into v_site from public.sites s where s.id = p_site;
  v_who := v_emp.full_name;
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, 'backdate_pending', 'มีคำขอลงชื่อย้อนหลังรออนุมัติ',
         v_who || ' · ' || to_char(p_date, 'DD/MM/YYYY') || ' · ' || coalesce(v_site, 'โครงการ'),
         '/approvals'
  from public.profiles p
  where p.role = 'owner' and p.is_active;

  return v_id;
end $$;

-- ── 4 · อนุมัติ / ตีกลับ (เจ้าของ) ────────────────────────────────────
create or replace function public.attendance_backdate_decide(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_req  public.attendance_backdate_requests%rowtype;
  v_att  uuid;
  v_who  text;
  v_body text;
begin
  if v_uid is null or not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่อนุมัติได้';
  end if;

  -- 🔴 ล็อกแถวก่อนอ่านสถานะ — กดอนุมัติซ้ำสองครั้งพร้อมกันต้องได้แถวเดียว
  select * into v_req from public.attendance_backdate_requests r where r.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: ไม่พบคำขอนี้';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUEST_DECIDED: คำขอนี้ถูกตัดสินหรือยกเลิกไปแล้ว';
  end if;

  select e.full_name into v_who from public.employees e where e.id = v_req.employee_id;
  v_body := coalesce(v_who, 'คนงาน') || ' · ' || to_char(v_req.work_date, 'DD/MM/YYYY');

  if p_approve then
    if public.attendance_paid(v_req.employee_id, v_req.work_date, v_req.site_id) then
      raise exception 'PAYROLL_CLOSED: วันนั้นถูกจ่ายค่าแรงไปแล้ว ลงชื่อเพิ่มไม่ได้';
    end if;
    -- insert ในนามเจ้าของ → guard เดิมตรวจครบ (เพดาน 1 วัน · คนถูกปิดใช้งาน)
    -- ถ้าไม่ผ่านจะโยน error ออกไปทั้งก้อน คำขอยังเป็น pending ให้ตัดสินใจใหม่
    insert into public.attendance (site_id, employee_id, work_date, work_units, note)
    values (v_req.site_id, v_req.employee_id, v_req.work_date, v_req.work_units,
            'ลงย้อนหลัง (อนุมัติแล้ว): ' || v_req.reason)
    returning id into v_att;

    update public.attendance_backdate_requests
       set status = 'approved', decided_by = v_uid, decided_at = now(), attendance_id = v_att
     where id = p_id;

    insert into public.notifications (user_id, kind, title, body, link)
    values (v_req.requested_by, 'backdate_approved',
            'คำขอลงชื่อย้อนหลังของคุณได้รับอนุมัติแล้ว', v_body, '/attendance');
  else
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'REASON_REQUIRED: ตีกลับต้องบอกเหตุผล';
    end if;
    update public.attendance_backdate_requests
       set status = 'rejected', decided_by = v_uid, decided_at = now(),
           rejected_reason = left(btrim(p_reason), 500)
     where id = p_id;

    insert into public.notifications (user_id, kind, title, body, link)
    values (v_req.requested_by, 'backdate_rejected',
            'คำขอลงชื่อย้อนหลังของคุณไม่ได้รับอนุมัติ',
            left(btrim(p_reason), 300) || ' (' || v_body || ')', '/attendance');
  end if;

  return p_id;
end $$;

-- ── 5 · ยกเลิกคำขอของตัวเอง (ตอนยังไม่ตัดสิน) ─────────────────────────
create or replace function public.attendance_backdate_cancel(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.attendance_backdate_requests%rowtype;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_req from public.attendance_backdate_requests r where r.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND: ไม่พบคำขอนี้';
  end if;
  if v_req.requested_by <> v_uid and not (select public.is_owner()) then
    raise exception 'FORBIDDEN: ยกเลิกได้เฉพาะคำขอของตัวเอง';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUEST_DECIDED: คำขอนี้ถูกตัดสินหรือยกเลิกไปแล้ว';
  end if;
  update public.attendance_backdate_requests
     set status = 'cancelled', decided_by = v_uid, decided_at = now()
   where id = p_id;
  return p_id;
end $$;

revoke execute on function public.attendance_backdate_request(uuid, uuid, date, numeric, text) from public, anon;
revoke execute on function public.attendance_backdate_decide(uuid, boolean, text) from public, anon;
revoke execute on function public.attendance_backdate_cancel(uuid) from public, anon;
grant execute on function public.attendance_backdate_request(uuid, uuid, date, numeric, text) to authenticated;
grant execute on function public.attendance_backdate_decide(uuid, boolean, text) to authenticated;
grant execute on function public.attendance_backdate_cancel(uuid) to authenticated;
