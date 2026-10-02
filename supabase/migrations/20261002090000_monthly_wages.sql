-- ค่าแรงรายเดือน (คำขอเจ้าของ 2 ต.ค. 2569 · จ่ายค่าแรงทุกวันที่ 5 ของเดือนถัดไป)
--
-- 1 · ใบสรุปค่าแรงคงค้างในบอท (เมนู 5) = "เดือนใครเดือนมันคับ" — เลือกเดือน แล้วนับเฉพาะ
--     งาน · เงินที่ออกก่อน · ใบเบิก ที่ลงวันในเดือนนั้น
--     · เบิกเกินค่าแรงของเดือน = "เบิกล่วงหน้าของเดือนถัดไป" (ยกไปหักเดือนถัดไป)
-- 2 · ปุ่มจ่าย "จ่ายถึงสิ้นเดือน" — งาน/เงินที่ออกก่อน/ใบเบิกที่ลงวัน**หลัง**วันตัด
--     ไม่ถูกนับและไม่ถูกหัก (เดิมจ่ายทุกอย่างจนถึงวันที่กด → วันที่ 5 ต.ค. กินงาน 1–5 ต.ค. ไปด้วย)
--
-- 🔴 สูตรเดียว: ยอดของเดือน M = payroll_balances_through(สิ้นเดือน M)
--    − ยอดบวกที่ค้างก่อนเดือน M (ถ้ามี) · ยอดติดลบก่อนเดือน M = เบิกล่วงหน้ายกมา
--    → ใบสรุปเดือน M = เงินที่ปุ่ม "จ่ายถึงสิ้นเดือน M" จ่ายจริงทุกบาท
--      (เมื่อเดือนก่อน ๆ จ่ายไปแล้ว ซึ่งคือการใช้งานปกติ)

-- ── 1 · วันตัดของรอบจ่าย ────────────────────────────────────────────────
alter table public.payroll_runs add column if not exists through_date date;
comment on column public.payroll_runs.through_date is
  'วันตัดของรอบ (จ่ายถึงสิ้นเดือน) · เงินที่ออกก่อน/ใบเบิกที่ลงวันหลังวันนี้ไม่ถูกคืน/หักในรอบนี้ · null = ไม่มีวันตัด (รอบก่อน 2 ต.ค. 2569)';

-- ── 2 · ยอดค้างจ่ายรายคน "ถึงวันที่" ─────────────────────────────────────
-- คัดลอกฉบับ R15 ทั้งตัว เพิ่มเฉพาะเงื่อนไขวันตัด · p_through = null = ทุกอย่าง (เท่าเดิม)
create or replace function public.payroll_balances_through(p_through date)
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
    select sum(t.amount) as total
    from public.transactions t
    where t.owed_employee_id = e.id
      and t.status = 'approved'
      and t.settled_run_id is null
      and (p_through is null or t.txn_date <= p_through)
  ) ow on true
  left join lateral (
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = e.id
      and ad.payroll_run_id is null
      and ad.status = 'approved'
      and (p_through is null or ad.advance_date <= p_through)
  ) adv on true
  where (select public.is_owner())
    and (coalesce(acc.total, 0) <> 0 or coalesce(adv.total, 0) <> 0 or coalesce(ow.total, 0) <> 0)
  order by e.full_name;
$$;

revoke execute on function public.payroll_balances_through(date) from public, anon;
grant execute on function public.payroll_balances_through(date) to authenticated;

-- ตัวเดิมห่อตัวใหม่ (ชื่อ/คอลัมน์เท่าเดิม — overdrawn_employees · /payroll · /approvals ใช้อยู่)
create or replace function public.payroll_balances()
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
  select * from public.payroll_balances_through(null) b order by b.full_name;
$$;

revoke execute on function public.payroll_balances() from public, anon;
grant execute on function public.payroll_balances() to authenticated;

-- ── 3 · ยอดของเดือนเดียว ─────────────────────────────────────────────
-- ทุกคอลัมน์ = (ถึงสิ้นเดือน) − (ถึงก่อนต้นเดือน) · ยอดก่อนต้นเดือน:
--   ติดลบ → carry_in   = เบิกล่วงหน้ายกมา หักในเดือนนี้
--   เป็นบวก → earlier_unpaid = ค่าแรงเดือนก่อนที่ยังไม่จ่าย (ไม่นับรวมในใบของเดือนนี้)
-- balance = ถึงสิ้นเดือน − earlier_unpaid → เท่ากับเงินที่ "จ่ายถึงสิ้นเดือน" จ่ายจริงเมื่อ earlier_unpaid = 0
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
  cur as (select * from public.payroll_balances_through((select m.me from m))),
  pre as (select * from public.payroll_balances_through((select m.ms - 1 from m)))
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

revoke execute on function public.payroll_month_balances(date) from public, anon;
grant execute on function public.payroll_month_balances(date) to authenticated;

-- ── 4 · เดือนที่มีของค้าง (ตัวเลือกในบอทและกล่องจ่าย) ─────────────────────
-- เดือนของงานที่ยังไม่จ่าย + เดือนของเงินที่ออกก่อนที่ยังไม่คืน + เดือนปัจจุบันถ้ามีใบเบิกค้าง
-- (ใบเบิกค้างของเดือนที่จ่ายไปแล้ว = ยกมา → โผล่ในเดือนถัดไปผ่าน carry_in ไม่ใช่เดือนของใบ)
create or replace function public.payroll_open_months()
returns setof date
language sql
stable
security definer
set search_path = ''
as $$
  select x.month
  from (
    select date_trunc('month', a.work_date)::date as month
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where aw.amount <> 0
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
    union
    select date_trunc('month', t.txn_date)::date
    from public.transactions t
    where t.owed_employee_id is not null
      and t.status = 'approved'
      and t.settled_run_id is null
    union
    select date_trunc('month', (now() at time zone 'Asia/Bangkok')::date)::date
    from public.advances ad
    where ad.payroll_run_id is null
      and ad.status = 'approved'
  ) x
  where (select public.is_owner())
  order by x.month;
$$;

revoke execute on function public.payroll_open_months() from public, anon;
grant execute on function public.payroll_open_months() to authenticated;

-- ── 5 · ปิดรอบจ่าย: + วันตัดของเงินที่ออกก่อนและใบเบิก ──────────────────
-- คัดลอกฉบับ R15 ทั้งตัว · เพิ่มเฉพาะ `v_run.through_date` สามที่ (owed · ยอดหัก · คิว FIFO)
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
    -- โบนัสเกิดตอนกดจ่าย (ลงวันที่กด) จึงไม่ติดวันตัด
    and (v_run.through_date is null or t.owed_kind = 'bonus' or t.txn_date <= v_run.through_date)
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
  -- ใบเบิกที่ลงวันหลังวันตัด = ของเดือนถัดไป ไม่หักในรอบนี้
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
      and (v_run.through_date is null or ad.advance_date <= v_run.through_date)
  ) d on true;

  -- ตัดใบเบิกแบบ FIFO เท่าที่หักได้จริง (สูตร R14 เดิม) · เก็บผลไว้ใช้ทำใบสรุปด้วย
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
      and (v_run.through_date is null or ad.advance_date <= v_run.through_date)
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
     and t.settled_run_id is null
     and (v_run.through_date is null or t.owed_kind = 'bonus' or t.txn_date <= v_run.through_date);

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

revoke execute on function public.close_payroll_run(uuid) from public, anon;
grant execute on function public.close_payroll_run(uuid) to authenticated;

-- ── 6 · จ่ายรายคน: + จ่ายถึงวันที่ ────────────────────────────────────────
-- 🔴 เปลี่ยนพารามิเตอร์ = drop ตัวเดิมก่อน ไม่งั้นได้สองฟังก์ชันชื่อเดียวกัน
-- แล้วตัวเก่า (ที่ไม่รู้จักวันตัด) ยังถูกเรียกได้อยู่เงียบ ๆ
drop function if exists public.pay_employee_wage(uuid, numeric, numeric);
create function public.pay_employee_wage(
  p_employee uuid,
  p_bonus    numeric default 0,
  -- เงินสดที่เจ้าของเห็นบนจอก่อนกด · ไม่ตรง = มีคนลงชื่อ/อนุมัติแทรกเข้ามา
  -- → ปฏิเสธ ไม่จ่ายตัวเลขที่เจ้าของไม่ได้ยืนยัน
  p_expected numeric default null,
  -- จ่ายถึงวันนี้ (สิ้นเดือนที่เลือก) · null = ทุกอย่างที่ค้าง (แบบเดิม)
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

  select min(a.work_date) filter (where aw.amount > 0),
         max(a.work_date) filter (where aw.amount > 0),
         sum(aw.amount)
  into v_from, v_to, v_acc
  from public.attendance a
  join public.attendance_wages aw on aw.attendance_id = a.id
  where a.employee_id = p_employee
    and (p_through is null or a.work_date <= p_through)
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id);

  select sum(t.amount) into v_owed
  from public.transactions t
  where t.owed_employee_id = p_employee
    and t.status = 'approved'
    and t.settled_run_id is null
    and (p_through is null or t.txn_date <= p_through);

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
    and ad.status = 'approved'
    and (p_through is null or ad.advance_date <= p_through);

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

revoke execute on function public.pay_employee_wage(uuid, numeric, numeric, date) from public, anon;
grant execute on function public.pay_employee_wage(uuid, numeric, numeric, date) to authenticated;

-- ── 7 · จ่ายทุกคน: + จ่ายถึงวันที่ (ทุกคนวันตัดเดียวกัน) ────────────────────
drop function if exists public.pay_employees(jsonb);
create function public.pay_employees(p_items jsonb, p_through date default null)
returns table (employee_id uuid, full_name text, paid numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_emp  uuid;
  v_name text;
  v_paid numeric;
begin
  if not (select public.is_owner()) then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่จ่ายค่าแรงได้';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'NOTHING_TO_PAY: ไม่ได้เลือกใครเลย';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_emp := (v_item->>'employee_id')::uuid;
    exception when others then
      raise exception 'EMPLOYEE_REQUIRED: รายการคนงานไม่ถูกต้อง';
    end;
    select e.full_name into v_name from public.employees e where e.id = v_emp;

    begin
      select r.paid into v_paid
      from public.pay_employee_wage(
        v_emp,
        coalesce((v_item->>'bonus')::numeric, 0),
        (v_item->>'expected')::numeric,
        p_through
      ) r;
    exception when others then
      raise exception '% [%]', sqlerrm, coalesce(v_name, 'ไม่ทราบชื่อ');
    end;

    employee_id := v_emp;
    full_name   := v_name;
    paid        := v_paid;
    return next;
  end loop;
end $$;

revoke execute on function public.pay_employees(jsonb, date) from public, anon;
grant execute on function public.pay_employees(jsonb, date) to authenticated;

-- ── 8 · บอท เมนู 5: เลือกเดือน → รายชื่อ → ใบสรุปของเดือน ─────────────────
create or replace function public.bot_wage_months(p_line_user text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._bot_as(p_line_user);
  return (
    select coalesce(jsonb_agg(to_char(x.m, 'YYYY-MM-DD') order by x.m), '[]'::jsonb)
    from public.payroll_open_months() as x(m));
end $$;

drop function if exists public.bot_wage_list(text);
-- p_month ไม่ส่ง = เดือนปัจจุบัน → บอทเวอร์ชันเก่า (เรียกแบบไม่มีเดือน) ยังใช้ได้ช่วงระหว่าง apply กับ deploy
create function public.bot_wage_list(p_line_user text, p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._bot_as(p_line_user);
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', b.employee_id, 'name', b.full_name, 'days', b.days, 'balance', b.balance)
           order by b.full_name), '[]'::jsonb)
    from public.payroll_month_balances(coalesce(p_month, (now() at time zone 'Asia/Bangkok')::date)) b);
end $$;

-- ขอบเขตเดียวกับ payroll_month_balances(): วันที่ยังไม่จ่ายในเดือน · เบิกที่อนุมัติแล้ว
-- และยังหักไม่ครบที่ลงวันในเดือน · เงินที่ออกก่อนที่ยังไม่คืนที่ลงวันในเดือน
drop function if exists public.bot_wage_detail(text, uuid);
create function public.bot_wage_detail(p_line_user text, p_employee uuid, p_month date default null)
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
          and t.txn_date between v_ms and v_me
        order by t.txn_date, t.created_at
        limit 40
      ) x), '[]'::jsonb),
    'owed_count', (select count(*) from public.transactions t
                    where t.owed_employee_id = p_employee and t.status = 'approved'
                      and t.settled_run_id is null and t.txn_date between v_ms and v_me),
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
          and ad.advance_date between v_ms and v_me
        order by ad.advance_date, ad.id
        limit 40
      ) x), '[]'::jsonb),
    'advance_count', (select count(*) from public.advances ad
                       where ad.employee_id = p_employee and ad.payroll_run_id is null
                         and ad.status = 'approved' and ad.advance_date between v_ms and v_me));
end $$;

-- ── 9 · สิทธิ์: บอท = service_role เท่านั้น (เหมือน bot_* ทุกตัว) ─────────────
revoke execute on function public.bot_wage_months(text) from public, anon, authenticated;
grant  execute on function public.bot_wage_months(text) to service_role;
revoke execute on function public.bot_wage_list(text, date) from public, anon, authenticated;
grant  execute on function public.bot_wage_list(text, date) to service_role;
revoke execute on function public.bot_wage_detail(text, uuid, date) from public, anon, authenticated;
grant  execute on function public.bot_wage_detail(text, uuid, date) to service_role;
