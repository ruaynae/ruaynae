-- ค่าแรงรายเดือน — เบิกของ "ช่วงรอยต่อ" ต้องถูกหักในรอบที่กำลังจ่าย ไม่ใช่รอเดือนถัดไป
-- (คำสั่งเจ้าของ 5 พ.ย. 2569 ผ่าน LINE)
--
-- เจ้าของจ่ายค่าแรงเดือน M ช้ากว่าสิ้นเดือนเสมอ (วันที่ 5 ของเดือนถัดไป หรือช้าไป 1-2 วัน)
-- ตัวอย่างจริง: จ่ายเดือนตุลาคมวันที่ 5 พ.ย. แต่คนงานเบิกเงินไปแล้ววันที่ 1-4 พ.ย.
-- (ก่อนเงินเดือนตุลาคมจะถึงมือ) — เจ้าของอยากให้เบิกก้อนนี้ถูกหักออกจากเงินเดือนตุลาคม
-- ทันที ไม่ใช่ปล่อยให้ค้างไปโผล่เป็น "เบิกของเดือนพฤศจิกายน" ซึ่งทำให้ดูเหมือนเดือน
-- พฤศจิกายนเบิกไปแล้วทั้งที่ยังไม่ได้รับค่าแรงเดือนนั้นเลย
--
-- 🔴 เดิม (migration 20261002090000) ผูกวันตัดเดียว (`p_through`/`through_date`) ทั้งงาน
-- และเงิน (เบิก/เงินที่ออกก่อน) เข้าด้วยกัน — ตอนนั้นแก้บั๊กที่ "จ่ายวันที่ 5 ต.ค. กินงาน
-- 1-5 ต.ค. ไปด้วย" ซึ่งเป็นเรื่องวันทำงานเท่านั้น แต่กฎเดียวกันถูกเหมาเอาไปใช้กับเบิก/
-- เงินที่ออกก่อนด้วย ทั้งที่มันคนละเรื่อง: วันทำงานเดือนหน้าต้องรอจ่ายเดือนหน้าจริง (ยังไม่เกิดสิทธิ์)
-- แต่เงินที่เบิกไปแล้วคือหนี้ปัจจุบันเสมอไม่ว่าจะลงวันไหน (ดู `payroll_open_months()` ที่ถือว่า
-- ใบเบิกค้างทุกใบอยู่ "เดือนปัจจุบัน" อยู่แล้ว — จุดนี้สนับสนุนว่าเบิก/เงินที่ออกก่อนไม่ควรมีวันตัด)
--
-- แก้โดยแยกวันตัดเป็นสองเส้น: งาน (`p_through`) ยังอยู่ที่สิ้นเดือนตามเดิม ·
-- เบิก/เงินที่ออกก่อน (`p_cash_through`) ไม่มีวันตัดอีกต่อไป (null เสมอ = กวาดทุกใบที่ยังค้าง
-- ไม่ว่าลงวันไหน) ยกเว้นตอนคำนวณ "ยอดก่อนเดือนนี้" (`pre` ใน payroll_month_balances)
-- ซึ่งยังต้องผูกวันตัดเดิมไว้ เพราะนั่นคือพรมแดนเวลาจริง (เบิกที่ยังไม่เกิดในวันนั้นจะไม่มีทางอยู่ใน `pre`)

-- ── 1 · payroll_balances_through: แยกวันตัดของเงินออกจากวันตัดของงาน ──────
drop function if exists public.payroll_balances_through(date);
create function public.payroll_balances_through(p_through date, p_cash_through date default null)
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  days        numeric,
  base        numeric,
  extra       numeric,
  deduct      numeric,
  accrued     numeric,
  owed        numeric,
  advanced    numeric,
  balance     numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.full_name,
    e.job_title,
    coalesce(acc.days, 0),
    coalesce(acc.base, 0),
    coalesce(adj.extra, 0),
    coalesce(adj.deduct, 0),
    coalesce(acc.total, 0),
    coalesce(ow.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) + coalesce(ow.total, 0) - coalesce(adv.total, 0)
  from public.employees e
  left join lateral (
    select
      sum(a.work_units)                       as days,
      sum(aw.work_units * aw.wage_snapshot)   as base,
      sum(aw.amount)                          as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = e.id
      and (p_through is null or a.work_date <= p_through)
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) acc on true
  left join lateral (
    select
      sum(ad.amount) filter (where ad.kind = 'add')    as extra,
      sum(ad.amount) filter (where ad.kind = 'deduct') as deduct
    from public.attendance_adjustments ad
    join public.attendance a on a.id = ad.attendance_id
    where a.employee_id = e.id
      and (p_through is null or a.work_date <= p_through)
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) adj on true
  left join lateral (
    -- 🔴 `approved` เท่านั้น — รายการที่รออนุมัติยังไม่ใช่เงินที่บริษัทติด
    -- เงินที่ออกก่อนไม่ผูกวันตัดของงาน (`p_cash_through` คนละตัวกับ `p_through`)
    select sum(t.amount) as total
    from public.transactions t
    where t.owed_employee_id = e.id
      and t.status = 'approved'
      and t.settled_run_id is null
      and (p_cash_through is null or t.txn_date <= p_cash_through)
  ) ow on true
  left join lateral (
    -- เบิกล่วงหน้าเป็นหนี้ปัจจุบันเสมอ ไม่ผูกวันตัดของงาน — ดู `payroll_open_months()`
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = e.id
      and ad.payroll_run_id is null
      and ad.status = 'approved'
      and (p_cash_through is null or ad.advance_date <= p_cash_through)
  ) adv on true
  where (select public.is_owner())
    and (coalesce(acc.total, 0) <> 0 or coalesce(adv.total, 0) <> 0 or coalesce(ow.total, 0) <> 0)
  order by e.full_name;
$$;

revoke execute on function public.payroll_balances_through(date, date) from public, anon;
grant execute on function public.payroll_balances_through(date, date) to authenticated;

-- ── 2 · payroll_month_balances: cur = เงินไม่มีวันตัด · pre = เงินตัดที่พรมแดนเดิม ──
-- `pre` คือยอด ณ สิ้นเดือนก่อน M จริง ๆ (พรมแดนเวลา) จึงยังต้องผูกวันตัดเดียวกับงาน
-- `cur` คือ "ถ้าจ่ายวันนี้" จึงกวาดเบิก/เงินที่ออกก่อนทุกใบที่ยังค้าง ไม่ว่าลงวันไหน
create or replace function public.payroll_month_balances(p_month date)
returns table (
  employee_id    uuid,
  full_name      text,
  job_title      text,
  days           numeric,
  base           numeric,
  extra          numeric,
  deduct         numeric,
  accrued        numeric,
  owed           numeric,
  advanced       numeric,
  carry_in       numeric,
  earlier_unpaid numeric,
  balance        numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select date_trunc('month', p_month)::date as ms,
           (date_trunc('month', p_month) + interval '1 month' - interval '1 day')::date as me
  ),
  cur as (select * from public.payroll_balances_through((select m.me from m), null)),
  pre as (select * from public.payroll_balances_through((select m.ms - 1 from m), (select m.ms - 1 from m)))
  select
    c.employee_id,
    c.full_name,
    c.job_title,
    c.days     - coalesce(p.days, 0),
    c.base     - coalesce(p.base, 0),
    c.extra    - coalesce(p.extra, 0),
    c.deduct   - coalesce(p.deduct, 0),
    c.accrued  - coalesce(p.accrued, 0),
    c.owed     - coalesce(p.owed, 0),
    c.advanced - coalesce(p.advanced, 0),
    greatest(0, -coalesce(p.balance, 0)),
    greatest(0,  coalesce(p.balance, 0)),
    c.balance  - greatest(0, coalesce(p.balance, 0))
  from cur c
  left join pre p on p.employee_id = c.employee_id
  where p_month is not null
    and (c.accrued  - coalesce(p.accrued, 0)  <> 0
      or c.owed     - coalesce(p.owed, 0)     <> 0
      or c.advanced - coalesce(p.advanced, 0) <> 0
      or coalesce(p.balance, 0) < 0)
  order by c.full_name;
$$;

-- ── 3 · pay_employee_wage: เบิก/เงินที่ออกก่อนไม่ผูกวันตัดของงานอีกต่อไป ──────
create or replace function public.pay_employee_wage(
  p_employee uuid,
  p_bonus    numeric default 0,
  p_expected numeric default null,
  p_through  date    default null
)
returns table (
  run_id     uuid,
  days       numeric,
  accrued    numeric,
  reimbursed numeric,
  bonus      numeric,
  deducted   numeric,
  paid       numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_from  date;
  v_to    date;
  v_acc   numeric;
  v_owed  numeric;
  v_adv   numeric;
  v_pool  numeric;
  v_net   numeric;
  v_bonus numeric := coalesce(p_bonus, 0);
  v_cat   uuid;
  v_run   uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่จ่ายค่าแรงได้';
  end if;

  select e.full_name into v_name from public.employees e where e.id = p_employee;
  if v_name is null then
    raise exception 'NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;

  if v_bonus < 0 or v_bonus <> round(v_bonus, 2) or v_bonus > 10000000 then
    raise exception 'BONUS_INVALID: ยอดโบนัสไม่ถูกต้อง';
  end if;

  -- งาน: ยังผูกวันตัดเดิม — งานเดือนถัดไปรอรอบเดือนถัดไปจริง (ยังไม่เกิดสิทธิ์วันนี้)
  select min(a.work_date) filter (where aw.amount > 0),
         max(a.work_date) filter (where aw.amount > 0),
         sum(aw.amount)
  into v_from, v_to, v_acc
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where a.employee_id = p_employee
    and (p_through is null or a.work_date <= p_through)
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id);

  -- เงินที่ออกก่อน/ใบเบิก: ไม่ผูกวันตัดของงานอีกต่อไป (คำสั่งเจ้าของ 5 พ.ย. 2569)
  -- หนี้ที่เกิดไปแล้วก่อนวันที่กดจ่ายจริง ไม่ว่าจะลงวันของเดือนไหน ถือเป็นหนี้ปัจจุบันเสมอ
  select sum(t.amount) into v_owed
  from public.transactions t
  where t.owed_employee_id = p_employee
    and t.status = 'approved'
    and t.settled_run_id is null;

  if v_from is null and coalesce(v_owed, 0) = 0 and v_bonus = 0 then
    raise exception 'NOTHING_TO_PAY: คนนี้ไม่มียอดค้างจ่าย';
  end if;

  -- วันทำงานเก่าที่ลงทีหลัง (ก่อนรอบที่จ่ายไปแล้ว) ทำให้ช่วงวันของรอบนี้คร่อมรอบเก่า
  -- → exclusion constraint ล้มเป็น error กลาง ๆ · บอกเจ้าของตรง ๆ ว่าต้องจ่ายเดือนไหนก่อน
  if v_from is not null and exists (
    select 1 from public.payroll_runs r
    where r.employee_id = p_employee and r.site_id is null and r.covers_work
      and daterange(r.period_start, r.period_end + 1, '[)') && daterange(v_from, v_to + 1, '[)')
  ) then
    raise exception 'OLDER_DAY_UNPAID: % มีวันทำงานค้างวันที่ % ซึ่งอยู่ก่อนรอบที่จ่ายไปแล้ว — เลือกจ่ายถึงสิ้นเดือนของวันนั้นก่อน',
      v_name, to_char(v_from, 'YYYY-MM-DD');
  end if;

  -- สูตรเดียวกับ close_payroll_run — ใช้ตรวจตัวเลขที่เจ้าของเห็นเท่านั้น
  -- ยอดที่บันทึกจริงมาจาก close_payroll_run เสมอ
  select sum(ad.amount - ad.deducted_amount) into v_adv
  from public.advances ad
  where ad.employee_id = p_employee
    and ad.payroll_run_id is null
    and ad.status = 'approved';

  v_pool := (case when v_from is null then 0 else coalesce(v_acc, 0) end)
            + coalesce(v_owed, 0) + v_bonus;
  v_net  := v_pool - least(v_pool, coalesce(v_adv, 0));

  if p_expected is not null and round(p_expected, 2) <> round(v_net, 2) then
    raise exception 'BALANCE_CHANGED: ยอดของ % เปลี่ยนระหว่างที่เปิดหน้าจอ (ตอนนี้ ฿%)',
      v_name, to_char(v_net, 'FM999,999,990.00');
  end if;

  if v_bonus > 0 then
    select c.id into v_cat
    from public.categories c
    where c.kind = 'expense' and c.name = 'โบนัสพนักงาน';
    if v_cat is null then
      insert into public.categories (name, kind, is_active, sort_order)
      values ('โบนัสพนักงาน', 'expense', false, 900)
      returning id into v_cat;
    end if;

    -- โบนัสลงวันที่กดจ่ายจริง · วันตัดของ close_payroll_run ไม่ใช้กับโบนัส (เกิดในรอบนี้เอง)
    perform set_config('app.payroll_settle', '1', true);
    insert into public.transactions
      (kind, site_id, category_id, amount, txn_date, pay_method, status, note,
       owed_employee_id, owed_kind)
    values
      ('expense', null, v_cat, v_bonus, v_today, 'cash', 'approved', 'โบนัส — ' || v_name,
       p_employee, 'bonus');
    perform set_config('app.payroll_settle', '', true);
  end if;

  insert into public.payroll_runs (period_start, period_end, site_id, employee_id, covers_work, through_date)
  values (coalesce(v_from, v_today), coalesce(v_to, v_today), null, p_employee, v_from is not null, p_through)
  returning id into v_run;

  perform public.close_payroll_run(v_run);

  return query
    select v_run, l.days, l.accrued, l.reimbursed, l.bonus, l.advance_deducted, l.net_paid
    from public.payroll_lines l
    where l.run_id = v_run and l.employee_id = p_employee;
end $$;

-- ── 4 · close_payroll_run: เงินที่ออกก่อน/ใบเบิกไม่ผูก through_date อีกต่อไป ──────
create or replace function public.close_payroll_run(p_run uuid)
returns table (lines int, accrued numeric, deducted numeric, paid numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_n   int;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่ปิดรอบจ่ายได้';
  end if;

  select * into v_run from public.payroll_runs r where r.id = p_run for update;
  if not found then
    raise exception 'NOT_FOUND: ไม่พบรอบจ่ายนี้';
  end if;
  if v_run.status = 'closed' then
    raise exception 'ALREADY_CLOSED: รอบนี้ปิดไปแล้ว';
  end if;

  -- 🔴 "จ่ายทุกคน" เรียกฟังก์ชันนี้หลายครั้งในทรานแซกชันเดียว — `on commit drop`
  -- ยังไม่ทันลบ ตารางชั่วคราวชื่อเดิมจึงต้องลบเองก่อนสร้าง
  drop table if exists _acc, _owed, _pay, _alloc;

  create temporary table _acc on commit drop as
  select
    a.employee_id,
    sum(a.work_units)  as days,
    sum(aw.amount)     as accrued
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where v_run.covers_work
    and a.work_date between v_run.period_start and v_run.period_end
    and (v_run.site_id is null or a.site_id = v_run.site_id)
    and (v_run.employee_id is null or a.employee_id = v_run.employee_id)
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  group by a.employee_id
  having sum(aw.amount) > 0;

  -- เงินที่บริษัทติด — เฉพาะรอบที่เจาะจงคน (รอบรวมแบบเดิมไม่มีปุ่มสร้างแล้ว)
  -- 🔴 ไม่ผูก through_date อีกต่อไป (คำสั่งเจ้าของ 5 พ.ย. 2569) — เงินที่ออกก่อนที่ลงวัน
  -- หลังสิ้นเดือนแต่ก่อนวันกดจ่ายจริง ต้องถูกคืนในรอบนี้ ไม่ใช่รอรอบเดือนถัดไป
  create temporary table _owed on commit drop as
  select
    t.owed_employee_id as employee_id,
    coalesce(sum(t.amount) filter (where t.owed_kind = 'reimburse'), 0) as reimbursed,
    coalesce(sum(t.amount) filter (where t.owed_kind = 'bonus'), 0)     as bonus
  from public.transactions t
  where v_run.employee_id is not null
    and t.owed_employee_id = v_run.employee_id
    and t.status = 'approved'
    and t.settled_run_id is null
  group by t.owed_employee_id;

  create temporary table _pay on commit drop as
  select
    coalesce(c.employee_id, o.employee_id) as employee_id,
    coalesce(c.days, 0)       as days,
    coalesce(c.accrued, 0)    as accrued,
    coalesce(o.reimbursed, 0) as reimbursed,
    coalesce(o.bonus, 0)      as bonus
  from _acc c
  full join _owed o on o.employee_id = c.employee_id;

  select count(*) into v_n from _pay;
  if v_n = 0 then
    raise exception 'NOTHING_TO_PAY: ไม่มียอดค้างจ่ายในช่วงนี้';
  end if;

  -- ก้อนที่หักเบิกได้ = ค่าแรง + เงินที่ออกก่อน + โบนัส (คำตอบเจ้าของข้อ 2)
  -- หักได้มากสุดเท่าก้อนนี้ — เงินสดที่ยื่นให้จึงไม่ติดลบ
  -- 🔴 ใบเบิกไม่ผูก through_date อีกต่อไป — ใบที่ลงวันหลังสิ้นเดือนแต่ก่อนวันกดจ่ายจริง
  -- ถูกหักในรอบนี้เลย (คำสั่งเจ้าของ 5 พ.ย. 2569)
  insert into public.payroll_lines
    (run_id, employee_id, days, accrued, reimbursed, bonus, advance_deducted, net_paid)
  select
    p_run,
    p.employee_id,
    p.days,
    p.accrued,
    p.reimbursed,
    p.bonus,
    least(p.accrued + p.reimbursed + p.bonus, coalesce(d.total, 0)),
    (p.accrued + p.reimbursed + p.bonus)
      - least(p.accrued + p.reimbursed + p.bonus, coalesce(d.total, 0))
  from _pay p
  left join lateral (
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = p.employee_id
      and ad.payroll_run_id is null
      and ad.status = 'approved'
  ) d on true;

  -- ตัดใบเบิกแบบ FIFO เท่าที่หักได้จริง (สูตร R14 เดิม) · เก็บผลไว้ใช้ทำใบสรุปด้วย
  -- 🔴 ไม่ผูก through_date — คิว FIFO กวาดทุกใบที่ยังค้าง ไม่ว่าลงวันไหน
  create temporary table _alloc on commit drop as
  with target as (
    select l.employee_id, l.advance_deducted as take
    from public.payroll_lines l
    where l.run_id = p_run and l.advance_deducted > 0
  ),
  queue as (
    select
      ad.id,
      ad.employee_id,
      ad.advance_date,
      ad.amount,
      ad.amount - ad.deducted_amount as open_amount,
      coalesce(sum(ad.amount - ad.deducted_amount) over (
        partition by ad.employee_id
        order by ad.advance_date, ad.id
        rows between unbounded preceding and 1 preceding
      ), 0) as before_amount
    from public.advances ad
    where ad.payroll_run_id is null
      and ad.status = 'approved'
      and ad.employee_id in (select t.employee_id from target t)
  )
  select
    q.id,
    q.employee_id,
    q.advance_date,
    q.amount,
    greatest(0, least(q.open_amount, t.take - q.before_amount)) as take
  from queue q
  join target t on t.employee_id = q.employee_id;

  update public.advances ad
     set deducted_amount = ad.deducted_amount + a.take,
         payroll_run_id  = case
                             when ad.deducted_amount + a.take >= ad.amount then p_run
                             else null
                           end
    from _alloc a
   where a.id = ad.id and a.take > 0;

  perform set_config('app.payroll_settle', '1', true);

  update public.transactions t
     set settled_run_id = p_run
   where v_run.employee_id is not null
     and t.owed_employee_id = v_run.employee_id
     and t.status = 'approved'
     and t.settled_run_id is null;

  -- ── สำเนารายละเอียดสำหรับใบสรุป ─────────────────────────────────
  -- ขอบเขตวันเดียวกับ `_acc` ทุกเงื่อนไข · รอบยังไม่ปิด จึงยังนับว่า "ยังไม่จ่าย"
  update public.payroll_lines l
     set breakdown = jsonb_build_object(
       'v', 1,
       'base', (
         select jsonb_build_object(
           'units',  coalesce(sum(aw.work_units), 0),
           'amount', coalesce(sum(aw.work_units * aw.wage_snapshot), 0))
         from public.attendance a
         join public.attendance_wages aw on aw.attendance_id = a.id
         where v_run.covers_work
           and a.employee_id = l.employee_id
           and a.work_date between v_run.period_start and v_run.period_end
           and (v_run.site_id is null or a.site_id = v_run.site_id)
           and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
       ),
       'adjustments', coalesce((
         select jsonb_agg(jsonb_build_object(
                  'name', x.name, 'kind', x.kind, 'times', x.times,
                  'total', x.total, 'dates', x.dates)
                order by x.kind, x.name)
         from (
           select ad.name, ad.kind, count(*)::int as times, sum(ad.amount) as total,
                  jsonb_agg(a.work_date order by a.work_date) as dates
           from public.attendance_adjustments ad
           join public.attendance a on a.id = ad.attendance_id
           where v_run.covers_work
             and a.employee_id = l.employee_id
             and a.work_date between v_run.period_start and v_run.period_end
             and (v_run.site_id is null or a.site_id = v_run.site_id)
             and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
           group by ad.name, ad.kind
         ) x
       ), '[]'::jsonb),
       'advances', coalesce((
         select jsonb_agg(jsonb_build_object(
                  'id', x.id, 'date', x.advance_date, 'amount', x.amount, 'taken', x.take)
                order by x.advance_date, x.id)
         from _alloc x
         where x.employee_id = l.employee_id and x.take > 0
       ), '[]'::jsonb),
       'owed', coalesce((
         select jsonb_agg(jsonb_build_object(
                  'id', t.id, 'kind', t.owed_kind, 'date', t.txn_date, 'amount', t.amount,
                  'category', c.name, 'site', s.name, 'note', t.note)
                order by t.txn_date, t.created_at)
         from public.transactions t
         left join public.categories c on c.id = t.category_id
         left join public.sites s on s.id = t.site_id
         where t.settled_run_id = p_run and t.owed_employee_id = l.employee_id
       ), '[]'::jsonb)
     )
   where l.run_id = p_run;

  perform set_config('app.payroll_settle', '', true);

  update public.payroll_runs r
    set status = 'closed',
        closed_at = now(),
        closed_by = auth.uid(),
        total_accrued = (select coalesce(sum(l.accrued), 0) from public.payroll_lines l where l.run_id = p_run),
        total_advance_deducted = (select coalesce(sum(l.advance_deducted), 0) from public.payroll_lines l where l.run_id = p_run),
        total_paid = (select coalesce(sum(l.net_paid), 0) from public.payroll_lines l where l.run_id = p_run)
    where r.id = p_run;

  return query
    select v_n,
           r.total_accrued, r.total_advance_deducted, r.total_paid
    from public.payroll_runs r where r.id = p_run;
end $$;

-- ── 5 · บอท เมนู 5: รายการเบิก/เงินที่ออกก่อนในใบของเดือน M = ตั้งแต่ต้นเดือน M เป็นต้นไป ──
-- (เดิม `between v_ms and v_me` ทำให้ใบเดือนนี้ไม่โชว์เบิกของเดือนถัดไปที่ถูกกวาดเข้ามาแล้ว
-- โดย payroll_month_balances — ยอดรวมถูกแต่รายการย่อยหาย ซึ่งทำให้คนงานงงว่ายอดมาจากไหน)
create or replace function public.bot_wage_detail(p_line_user text, p_employee uuid, p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b     record;
  v_m   date := coalesce(p_month, (now() at time zone 'Asia/Bangkok')::date);
  v_ms  date := date_trunc('month', v_m)::date;
  v_me  date := (date_trunc('month', v_m) + interval '1 month' - interval '1 day')::date;
begin
  perform public._bot_as(p_line_user);
  select * into b from public.payroll_month_balances(v_m) x where x.employee_id = p_employee;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOTHING');
  end if;

  return jsonb_build_object(
    'ok', true,
    'company', (select br.company_name from public.branding br limit 1),
    'name', b.full_name, 'job', b.job_title,
    'month', v_ms,
    'today', (now() at time zone 'Asia/Bangkok')::date,
    'days', b.days, 'base', b.base, 'extra', b.extra, 'deduct', b.deduct,
    'accrued', b.accrued, 'owed', b.owed, 'advanced', b.advanced,
    'carry_in', b.carry_in, 'earlier_unpaid', b.earlier_unpaid, 'balance', b.balance,
    'from', (select min(a.work_date) from public.attendance a
              where a.employee_id = p_employee
                and a.work_date between v_ms and v_me
                and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)),
    'to',   (select max(a.work_date) from public.attendance a
              where a.employee_id = p_employee
                and a.work_date between v_ms and v_me
                and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'units', x.units, 'amount', x.amount)
             order by x.first_day)
      from (
        select s.name, min(a.work_date) as first_day,
               sum(aw.work_units) as units, sum(aw.work_units * aw.wage_snapshot) as amount
        from public.attendance a
        join public.attendance_wages aw on aw.attendance_id = a.id
        join public.sites s on s.id = a.site_id
        where a.employee_id = p_employee
          and a.work_date between v_ms and v_me
          and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
        group by s.name
      ) x), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object('name', x.name, 'kind', x.kind, 'times', x.times, 'total', x.total)
             order by x.kind, x.name)
      from (
        select ad.name, ad.kind, count(*)::int as times, sum(ad.amount) as total
        from public.attendance_adjustments ad
        join public.attendance a on a.id = ad.attendance_id
        where a.employee_id = p_employee
          and a.work_date between v_ms and v_me
          and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
        group by ad.name, ad.kind
      ) x), '[]'::jsonb),
    -- เงินที่ออกก่อน: ตั้งแต่ต้นเดือนนี้เป็นต้นไป (ไม่มีเพดานบน) — ใบของเดือนก่อนที่ยังไม่จ่าย
    -- จะไม่โชว์ซ้ำที่นี่เพราะ `settled_run_id is null` ตัดรายการที่ถูกคืนไปแล้วออก และ
    -- รายการที่ค้างจากเดือนก่อนจะโผล่ในใบของเดือนนั้นเอง (earlier_unpaid) ไม่ใช่ที่นี่
    'owed_items', coalesce((
      select jsonb_agg(jsonb_build_object('date', x.txn_date, 'amount', x.amount,
               'category', x.category, 'site', x.site, 'note', x.note)
             order by x.txn_date, x.created_at)
      from (
        select t.txn_date, t.amount, t.created_at, c.name as category, s.name as site, t.note
        from public.transactions t
        left join public.categories c on c.id = t.category_id
        left join public.sites s on s.id = t.site_id
        where t.owed_employee_id = p_employee
          and t.status = 'approved'
          and t.settled_run_id is null
          and t.txn_date >= v_ms
        order by t.txn_date, t.created_at
        limit 40
      ) x), '[]'::jsonb),
    'owed_count', (select count(*) from public.transactions t
                    where t.owed_employee_id = p_employee and t.status = 'approved'
                      and t.settled_run_id is null and t.txn_date >= v_ms),
    -- เบิก: ตั้งแต่ต้นเดือนนี้เป็นต้นไป (ไม่มีเพดานบน) — เบิกของ "ช่วงรอยต่อ" ก่อนวันกดจ่าย
    -- จริงที่ถูกกวาดเข้าใบเดือนนี้แล้ว (payroll_month_balances) ต้องโชว์เป็นรายการที่นี่ด้วย
    -- ไม่ใช่แค่ยอดรวม — ไม่งั้นคนงานเห็นยอดเปลี่ยนโดยไม่รู้ว่าใบไหนทำให้เปลี่ยน
    'advances', coalesce((
      select jsonb_agg(jsonb_build_object('date', x.advance_date, 'amount', x.amount,
               'open', x.open_amount)
             order by x.advance_date, x.id)
      from (
        select ad.id, ad.advance_date, ad.amount, ad.amount - ad.deducted_amount as open_amount
        from public.advances ad
        where ad.employee_id = p_employee
          and ad.payroll_run_id is null
          and ad.status = 'approved'
          and ad.advance_date >= v_ms
        order by ad.advance_date, ad.id
        limit 40
      ) x), '[]'::jsonb),
    'advance_count', (select count(*) from public.advances ad
                       where ad.employee_id = p_employee and ad.payroll_run_id is null
                         and ad.status = 'approved' and ad.advance_date >= v_ms));
end $$;

revoke execute on function public.bot_wage_detail(text, uuid, date) from public, anon, authenticated;
grant  execute on function public.bot_wage_detail(text, uuid, date) to service_role;
