-- R16 · เลือกได้ว่าบัญชี LINE ไหนรับแจ้งเตือน "มีรออนุมัติ" (คำขอเจ้าของ 11 ต.ค. 2569)
-- เหตุ: เจ้าของคนเดียวผูก LINE หลายเครื่อง (เช่นเครื่องที่ใช้ช่วยคีย์ค่าใช้จ่าย) ซึ่งไม่ต้องการ
-- แจ้งเตือนรออนุมัติ · เดิมแจ้งเข้าทุกบัญชีที่ผูก
--
-- 🔴 ค่าตั้งต้น = เปิด (true) — บัญชีเดิมทุกบัญชีรับแจ้งเตือนต่อไปเหมือนเดิมจนกว่าเจ้าของจะปิดเอง
-- 🔴 additive ล้วน (คอลัมน์ใหม่ + ฟังก์ชันใหม่) → apply ก่อน deploy โค้ดได้ ไม่กระทบโค้ดเวอร์ชันเก่า
--    ⚠️ แต่ต้อง apply **ก่อน** deploy โค้ดใหม่ — โค้ดใหม่ select คอลัมน์นี้ ถ้ายังไม่มีหน้าตั้งค่า LINE
--    จะโหลดไม่ขึ้นและตัวส่งแจ้งเตือน LINE จะหยุด
-- 🔴 ผูกบัญชีเดิมซ้ำ (bot_link ลบแล้วเพิ่มใหม่) = กลับเป็นเปิด

alter table public.line_accounts
  add column if not exists notify_pending boolean not null default true;

-- เขียนผ่านฟังก์ชันเท่านั้น (ตาราง revoke จาก authenticated แล้ว มีแค่ select) · แบบเดียวกับ unlink_line_account
create or replace function public.set_line_account_notify(p_id uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_on is null then
    raise exception 'BAD_REQUEST' using errcode = '22023';
  end if;
  update public.line_accounts set notify_pending = p_on where id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.set_line_account_notify(uuid, boolean) from public, anon;
grant  execute on function public.set_line_account_notify(uuid, boolean) to authenticated;
