-- ════════════════════════════════════════════════════════════════════════
-- "ใครเบิกเกินอยู่เท่าไหร่" — ยอดติดลบรายคน ที่ทุกหน้าจออ่านจากสูตรเดียวกัน
-- (คำสั่งเจ้าของ 22 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เจ้าของสั่ง: *"เจ้าของอยากให้สามารถเบิกเกินได้ เราต้องมีลอจิกเก็บยอดติดลบไว้ด้วย
-- ของคนงานแต่ละคน และเมื่อลงชื่อเข้าโครงการ ต้องหักลบยอดที่เบิกเกินไป"*
--
-- 🔴 **การหักจริงยังเกิดตอนกดจ่ายค่าแรงเหมือนเดิม ไม่ใช่ตอนลงชื่อ** (เจ้าของเลือกเอง
-- 22 ก.ย. 2569) — เหตุผลเป็นเรื่องเงินล้วน ๆ: `คงเหลือ = ค่าแรงที่ยังไม่จ่าย − เบิกที่ยังไม่ถูกหัก`
-- · ถ้าหัก `deducted_amount` ตอนลงชื่อโดยที่วันนั้น **ยังไม่ถูกตีตราว่าจ่ายแล้ว**
--   ค่าแรงวันนั้นจะถูกนับสองรอบ (ทั้งลดหนี้และยังรอจ่าย) = หนี้หายฟรี ๆ เท่ากับค่าแรงวันนั้น
--   ตัวอย่างจริง: หนี้ ฿2,000 · ลงชื่อได้ ฿500 → ถ้าหักตอนลงชื่อ คงเหลือกลายเป็น −฿1,000
--   ทั้งที่ควรเป็น −฿1,500 · **บริษัทเสีย ฿500 โดยไม่มี error ที่ไหนเลย** (กับดักข้อ 1 ในอีกรูป)
-- · สิ่งที่เกิดตอนลงชื่ออยู่แล้วคือ **ยอดติดลบลดลงทันที** เพราะค่าแรงใหม่เข้าไปในสูตร
--   — ที่ขาดคือ "หน้าจอที่เอาตัวเลขนี้มาวางให้เห็น" ซึ่งคือสิ่งที่ไฟล์นี้เพิ่ม
--
-- ร่องรอยของการหักจริงอยู่ใน `audit_log` อยู่แล้ว: `close_payroll_run()` อัปเดต
-- `advances.deducted_amount` ซึ่งมี audit trigger ติดอยู่ → มี before/after ของทุกใบ

-- ── ใครติดลบอยู่บ้าง ─────────────────────────────────────────────────
-- 🔴 **ไม่ใช่ `security definer`** โดยตั้งใจ — `payroll_balances()` เป็น definer และมี
-- `where is_owner()` อยู่ข้างในแล้ว · ใส่ definer ซ้ำอีกชั้นคือประตูบานที่สองที่ต้องจำ
-- ไปตรวจทุกครั้งที่กฎเปลี่ยน · หัวหน้าโครงการเรียกได้แต่ได้ 0 แถว (ค่าแรงเป็นความลับ
-- จากเขาตาม P4.5) → **หน้าจอต้องไม่วาดการ์ดนี้ให้เขาเลย ไม่ใช่วาดศูนย์**
create or replace function public.overdrawn_employees()
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  accrued     numeric,
  advanced    numeric,
  /** ติดลบเสมอในผลลัพธ์นี้ — เก็บเครื่องหมายไว้ ไม่กลับเป็นบวก
      เพื่อให้หน้าจอที่เอาไปบวกกับยอดอื่นไม่ต้องจำว่าต้องกลับเครื่องหมายเอง */
  balance     numeric
)
language sql
stable
set search_path = ''
as $$
  select b.employee_id, b.full_name, b.job_title, b.accrued, b.advanced, b.balance
  from public.payroll_balances() b
  where b.balance < 0
  order by b.balance asc, b.full_name
$$;

revoke execute on function public.overdrawn_employees() from public, anon;
grant execute on function public.overdrawn_employees() to authenticated;

-- ── สรุปหัวเดียวสำหรับแถบเตือนหน้าแรก ────────────────────────────────
-- รวมยอดในฐานข้อมูล ไม่ใช่ดึงแถวมาบวกใน JS (CLAUDE.md §7)
create or replace function public.overdrawn_summary()
returns table (people int, total numeric)
language sql
stable
set search_path = ''
as $$
  select count(*)::int, coalesce(sum(-o.balance), 0)
  from public.overdrawn_employees() o
$$;

revoke execute on function public.overdrawn_summary() from public, anon;
grant execute on function public.overdrawn_summary() to authenticated;
