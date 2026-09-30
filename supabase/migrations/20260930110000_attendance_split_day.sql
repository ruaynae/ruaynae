-- วันที่ลงชื่อสองโครงการ (ครึ่ง + ครึ่ง) — แจ้งโดยเจ้าของ 30 ก.ย. 2569
-- 🔴 เดิม save_attendance_day ลบแถวของโครงการอื่นในวันนั้น "ทุกแถว" ก่อนบันทึก
--    (ออกแบบไว้ให้ตารางการทำงานย้ายวันจากโครงการ A ไป B) · แต่วันที่ลงชื่อสองโครงการ
--    กดแก้ในตารางแล้วบันทึก = อีกครึ่งวันหายไปเงียบ ๆ พร้อมค่าแรงของมัน
--    และดินสอแก้ค่าแรงในแท็บ "ทำงานที่ไหนบ้าง" ก็เรียกฟังก์ชันนี้ทีละโครงการ = ลบอีกฝั่งทุกครั้ง
-- กติกาใหม่:
--   · มีแถวของโครงการนี้อยู่แล้ว → แก้แถวนั้น ไม่แตะโครงการอื่น
--   · ยังไม่มี และวันนั้นมีแถวอื่นแถวเดียว → ย้ายโครงการ (พฤติกรรมเดิมของตาราง)
--   · ยังไม่มี และวันนั้นมีหลายแถว → MULTI_SITE_DAY (ให้ไปแก้ที่หน้าลงชื่อเข้างาน)
-- และแก้บั๊กเดิมอีกตัว: แก้วันที่ลงเต็มวันไว้แล้ว → WORK_UNITS_EXCEEDED เสมอ (ดูคอมเมนต์ในตัวฟังก์ชัน)
create or replace function public.save_attendance_day(
  p_employee   uuid,
  p_site       uuid,
  p_date       date,
  p_work_units numeric,
  p_wage       numeric,
  p_ot         numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_mine  boolean;
  v_other int;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่แก้ตารางค่าแรงได้';
  end if;

  if p_date > v_today then
    raise exception 'DATE_FUTURE: ลงชื่อล่วงหน้าไม่ได้ — ค่าแรงของวันที่ยังไม่มาถึงคือต้นทุนที่ยังไม่เกิด';
  end if;
  if p_work_units is null or p_work_units not in (0.5, 1) then
    raise exception 'WORK_UNITS_INVALID: ลงได้เฉพาะเต็มวันหรือครึ่งวัน';
  end if;
  if p_wage is null or p_wage < 0 or coalesce(p_ot, 0) < 0 then
    raise exception 'AMOUNT_INVALID: ค่าแรงติดลบไม่ได้';
  end if;
  if public.attendance_paid(p_employee, p_date, p_site) then
    raise exception 'PAYROLL_CLOSED: วันนี้ถูกจ่ายไปแล้ว แก้ไม่ได้';
  end if;

  select exists (select 1 from public.attendance a
                  where a.employee_id = p_employee and a.work_date = p_date and a.site_id = p_site),
         (select count(*) from public.attendance a
           where a.employee_id = p_employee and a.work_date = p_date and a.site_id is distinct from p_site)
    into v_mine, v_other;

  if not v_mine and v_other > 1 then
    raise exception 'MULTI_SITE_DAY: วันนี้ลงชื่อไว้หลายโครงการ แก้ที่หน้าลงชื่อเข้างานแทน';
  end if;
  if not v_mine and v_other = 1 then
    delete from public.attendance a
     where a.employee_id = p_employee
       and a.work_date = p_date
       and a.site_id is distinct from p_site;
  end if;

  -- 🔴 ห้าม insert … on conflict do update กับแถวที่มีอยู่แล้ว: trigger ก่อน insert (guard_attendance)
  -- ทำงานก่อนตรวจชน แล้วนับแถวเดิมของโครงการเดียวกันรวมเข้าไปด้วย → วันเต็มวันแก้ไม่ได้เลย
  -- (1 + 1 > 1 → WORK_UNITS_EXCEEDED) · update ตรง ๆ ตัว guard ตัดแถวตัวเองออกให้ถูกต้อง
  if v_mine then
    update public.attendance a
       set work_units = p_work_units
     where a.employee_id = p_employee and a.work_date = p_date and a.site_id = p_site
    returning a.id into v_id;
  else
    insert into public.attendance (employee_id, site_id, work_date, work_units)
    values (p_employee, p_site, p_date, p_work_units)
    returning id into v_id;
  end if;

  update public.attendance_wages
     set wage_snapshot = p_wage,
         work_units = p_work_units
   where attendance_id = v_id;

  if p_ot is not null then
    perform public.set_attendance_ot(v_id, p_ot);
  end if;

  return v_id;
end $$;

revoke execute on function public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric)
  from public, anon;
grant execute on function public.save_attendance_day(uuid, uuid, date, numeric, numeric, numeric)
  to authenticated;
