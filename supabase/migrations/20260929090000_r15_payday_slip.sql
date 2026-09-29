-- ════════════════════════════════════════════════════════════════════════
-- R15 · ใบสรุปวันจ่ายค่าแรง + เงินที่คนงานออกให้ก่อน + โบนัส (29 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เจ้าของ: *"วันที่เงินค่าแรงออก ผมต้องสรุปค่าใช้จ่าย ส่งให้ทุกคน ว่าแต่ละคนได้กี่แรง
-- เป็นเงินกี่บาท เบิกไปกี่บาท ได้เบี้ยเลี้ยง ต่างจังหวัดกี่บาท คงเหลือเท่าไหร่
-- บางคนเช่นหัวหน้างาน จะออกเงินให้ก่อน เช่นซื้อน้ำแข็ง หรือจ่ายค่าขนส่งวัสดุ …
-- ผมก็จะบวกไปในใบสรุปว่าคนงานคนนั้นออกเงินไปก่อนกี่บาท"*
--
-- คำตอบของเจ้าของ (docs/test-plan/R15-payday-slip.md): หักหนี้เบิกก่อนคืนเงินสด ·
-- โบนัสปีละครั้งกรอกตอนกดจ่าย · หัวหน้าโครงการคีย์เงินที่ออกก่อนได้ (รออนุมัติ)
--
-- 🔴 หลักคิดเรื่องเงิน
--   · เงินที่ออกก่อน = **ต้นทุนของรายจ่ายนั้น** (แถว `transactions` ตามหมวด/โครงการจริง
--     เข้าต้นทุนครั้งเดียวตอนอนุมัติ) · ตอนจ่ายค่าแรงแค่ **คืนเงินสด** ไม่ใช่ต้นทุนใหม่
--   · โบนัส = รายจ่ายส่วนกลางหมวด "โบนัสพนักงาน" ที่เกิดในทรานแซกชันเดียวกับการจ่าย
--   · ก้อนที่หักเบิกได้ = ค่าแรงค้าง + เงินที่ออกก่อน + โบนัส  (คำตอบข้อ 2 = หักหนี้ก่อน)

-- ── 1 · รอบที่ "ไม่ครอบวันทำงาน" ────────────────────────────────────
-- 🔴 กับดัก: คนที่มีแต่เงินที่ออกก่อน/โบนัส ไม่มีวันทำงานค้าง ก็ต้องจ่ายได้ แต่รอบจ่าย
-- ต้องมีช่วงวันที่ · ถ้าช่วงนั้นถูก `attendance_paid()` นับ วันทำงานที่ลงทีหลังในช่วงเดียวกัน
-- จะถูกถือว่า "จ่ายแล้ว" ทั้งที่ไม่เคยมีเงินออก และ guard จะห้ามลงชื่อวันนั้นอีกด้วย
-- → รอบแบบนี้ติด `covers_work = false` แล้วทุกที่ที่อ่านช่วงวันของรอบต้องข้ามมัน
alter table public.payroll_runs
  add column if not exists covers_work boolean not null default true;

comment on column public.payroll_runs.covers_work is
  'false = รอบที่จ่ายเฉพาะเงินที่ออกก่อน/โบนัส · ช่วงวันที่เป็นแค่ป้าย ไม่ได้ปิดวันทำงาน';

alter table public.payroll_runs drop constraint if exists payroll_runs_no_overlap;
alter table public.payroll_runs add constraint payroll_runs_no_overlap
  exclude using gist (
    coalesce(site_id,     '00000000-0000-0000-0000-000000000000'::uuid) with =,
    coalesce(employee_id, '00000000-0000-0000-0000-000000000000'::uuid) with =,
    daterange(period_start, period_end + 1, '[)') with &&
  ) where (covers_work);

create or replace function public.attendance_paid(
  p_employee uuid,
  p_work_date date,
  p_site uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.payroll_lines pl
    join public.payroll_runs pr on pr.id = pl.run_id
    where pl.employee_id = p_employee
      and pr.status = 'closed'
      and pr.covers_work
      and p_work_date between pr.period_start and pr.period_end
      and (pr.site_id is null or pr.site_id = p_site)
  );
$$;

revoke execute on function public.attendance_paid(uuid, date, uuid) from public, anon;
grant execute on function public.attendance_paid(uuid, date, uuid) to authenticated;

-- ── 2 · บรรทัดจ่าย: เก็บรายละเอียดไว้ตอนจ่าย ───────────────────────────
-- ใบสรุปอ่านจากสำเนานี้ ไม่คำนวณใหม่ · เจ้าของแก้ชื่อรายการปรับหรือเรตค่าแรง
-- ทีหลัง ใบของวันที่จ่ายไปแล้วต้องไม่เปลี่ยน · แถวก่อน R15 เป็น null (ไม่ backfill —
-- ยอดหักเบิกบางส่วนต่อรอบย้อนหลังสร้างใหม่ไม่ได้ ห้ามแต่งตัวเลข)
alter table public.payroll_lines
  add column if not exists reimbursed numeric(14,2) not null default 0,
  add column if not exists bonus      numeric(14,2) not null default 0,
  add column if not exists breakdown  jsonb;

alter table public.payroll_lines drop constraint if exists payroll_lines_reimbursed_nonneg;
alter table public.payroll_lines add constraint payroll_lines_reimbursed_nonneg check (reimbursed >= 0);
alter table public.payroll_lines drop constraint if exists payroll_lines_bonus_nonneg;
alter table public.payroll_lines add constraint payroll_lines_bonus_nonneg check (bonus >= 0);

comment on column public.payroll_lines.reimbursed is 'คืนเงินที่คนงานออกให้ก่อน (เงินสดออก ไม่ใช่ต้นทุน)';
comment on column public.payroll_lines.bonus is 'โบนัสที่จ่ายพร้อมรอบนี้ (ต้นทุนอยู่ที่แถว transactions หมวดโบนัส)';
comment on column public.payroll_lines.net_paid is 'เงินสดที่ยื่นให้จริง = accrued + reimbursed + bonus − advance_deducted';
comment on column public.payroll_lines.breakdown is 'สำเนารายละเอียด ณ วันจ่าย: base · adjustments · advances · owed (null = จ่ายก่อน R15)';

-- หลักฐานการจ่ายเงินแก้ไม่ได้ — เขียนได้เฉพาะระหว่าง close_payroll_run()
-- (ธง `app.payroll_settle` เป็นของทรานแซกชัน ตั้งได้จากในฟังก์ชันเท่านั้น
-- PostgREST ไม่เปิดให้ client เรียก set_config)
create or replace function public.guard_payroll_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.payroll_settle', true), '') <> '1' then
    raise exception 'PAYROLL_CLOSED: บรรทัดจ่ายเงินที่บันทึกแล้วแก้ไม่ได้';
  end if;
  return new;
end $$;

revoke execute on function public.guard_payroll_line() from public, anon, authenticated;

drop trigger if exists payroll_lines_guard on public.payroll_lines;
create trigger payroll_lines_guard before update on public.payroll_lines
  for each row execute function public.guard_payroll_line();

-- ── 3 · รายจ่ายที่ "บริษัทติดเงินคนงาน" ──────────────────────────────
do $$ begin
  create type public.owed_kind as enum ('reimburse', 'bonus');
exception when duplicate_object then null; end $$;

alter table public.transactions
  add column if not exists owed_employee_id uuid references public.employees(id) on delete restrict,
  add column if not exists owed_kind public.owed_kind,
  add column if not exists settled_run_id uuid references public.payroll_runs(id) on delete restrict;

comment on column public.transactions.owed_employee_id is
  'คนงานที่ออกเงินแทนบริษัท (reimburse) หรือได้โบนัส (bonus) · บริษัทติดเงินคนนี้จนกว่าจะจ่าย';
comment on column public.transactions.settled_run_id is
  'รอบจ่ายที่คืนเงินให้แล้ว · null = ยังค้าง · เขียนได้เฉพาะ close_payroll_run()';

alter table public.transactions drop constraint if exists transactions_owed_pair;
alter table public.transactions add constraint transactions_owed_pair
  check ((owed_employee_id is null) = (owed_kind is null));
alter table public.transactions drop constraint if exists transactions_owed_expense;
alter table public.transactions add constraint transactions_owed_expense
  check (owed_employee_id is null or kind = 'expense');
alter table public.transactions drop constraint if exists transactions_settled_needs_owed;
alter table public.transactions add constraint transactions_settled_needs_owed
  check (settled_run_id is null or owed_employee_id is not null);

create index if not exists transactions_owed_open_idx
  on public.transactions(owed_employee_id) where owed_employee_id is not null and settled_run_id is null;
create index if not exists transactions_settled_run_idx
  on public.transactions(settled_run_id) where settled_run_id is not null;

-- 🔴 guard แยกตัว ไม่แก้ guard_transaction เดิม — กติกาเดิมทุกข้อยังทำงานเหมือนเดิม
-- ตัวนี้ดูแลเฉพาะสามคอลัมน์ใหม่
create or replace function public.guard_transaction_owed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  boolean := public.is_owner();
  v_settle boolean := coalesce(current_setting('app.payroll_settle', true), '') = '1'
                      and (v_owner or auth.uid() is null);
begin
  if tg_op = 'DELETE' then
    -- เงินสดคืนคนงานไปแล้ว — ลบรายจ่ายทิ้ง = ต้นทุนหายแต่เงินออกไปแล้ว
    -- 🔴 เจ้าของก็ลบไม่ได้ (ต่างจากรายการปกติ §5 ข้อ 3) เพราะมีเงินสดผูกอยู่
    if old.settled_run_id is not null and not v_settle then
      raise exception 'PAYROLL_CLOSED: รายการนี้คืนเงินให้คนงานไปแล้ว ลบไม่ได้';
    end if;
    return old;
  end if;

  -- ชนิดตามมากับคนเสมอ — ส่งคนมาอย่างเดียว = คนงานออกเงินให้ก่อน
  if new.owed_employee_id is null then
    new.owed_kind := null;
  elsif new.owed_kind is null then
    new.owed_kind := 'reimburse';
  end if;

  if tg_op = 'INSERT' then
    if (new.settled_run_id is not null or new.owed_kind = 'bonus') and not v_settle then
      raise exception 'OWED_FORBIDDEN: โบนัสและการคืนเงินเกิดจากปุ่มจ่ายค่าแรงเท่านั้น';
    end if;
  else
    if old.settled_run_id is not null and not v_settle then
      if new.amount is distinct from old.amount
         or new.kind is distinct from old.kind
         or new.status is distinct from old.status
         or new.owed_employee_id is distinct from old.owed_employee_id
         or new.owed_kind is distinct from old.owed_kind then
        raise exception 'PAYROLL_CLOSED: รายการนี้คืนเงินให้คนงานไปแล้ว แก้ยอด สถานะ หรือคนไม่ได้';
      end if;
    end if;
    if not v_settle then
      if new.settled_run_id is distinct from old.settled_run_id then
        raise exception 'OWED_FORBIDDEN: การคืนเงินเกิดจากปุ่มจ่ายค่าแรงเท่านั้น';
      end if;
      if (new.owed_kind = 'bonus') is distinct from (old.owed_kind = 'bonus') then
        raise exception 'OWED_FORBIDDEN: โบนัสเกิดจากปุ่มจ่ายค่าแรงเท่านั้น';
      end if;
    end if;
  end if;

  -- คนที่เลือกต้องเป็นคนงานที่ยังทำงานอยู่ (ชื่อที่ทุก role เห็นได้ตาม employees_select)
  if new.owed_employee_id is not null
     and (tg_op = 'INSERT' or new.owed_employee_id is distinct from old.owed_employee_id)
     and not v_settle
     and not exists (
       select 1 from public.employees e where e.id = new.owed_employee_id and e.is_active
     ) then
    raise exception 'OWED_EMPLOYEE_INVALID: ไม่พบคนงานคนนี้ หรือปิดใช้งานไปแล้ว';
  end if;

  return new;
end $$;

revoke execute on function public.guard_transaction_owed() from public, anon, authenticated;

drop trigger if exists transactions_guard_owed on public.transactions;
create trigger transactions_guard_owed before insert or update or delete on public.transactions
  for each row execute function public.guard_transaction_owed();

-- หมวดของโบนัส — ปิดใช้งานไว้ ไม่ให้โผล่ในชิปหมวดของฟอร์มบันทึก
-- (คีย์โบนัสเองจากฟอร์ม = ต้นทุนที่ไม่มีเงินสดออกคู่กัน · ต้องมาจากปุ่มจ่ายเท่านั้น)
insert into public.categories (name, kind, is_active, sort_order)
values ('โบนัสพนักงาน', 'expense', false, 900)
on conflict (kind, name) do nothing;

-- ── 4 · ยอดค้างจ่ายรายคน: + เงินที่บริษัทติดคนงาน ─────────────────────
-- คัดลอกฉบับ R14 ทั้งตัว เพิ่มเฉพาะ `owed` · balance = ค่าแรงค้าง + ที่บริษัทติด − เบิก
-- `overdrawn_employees()` ห่อตัวนี้อยู่ → เงินที่ออกก่อนลดยอดติดลบเอง (คำตอบข้อ 2)
drop function if exists public.payroll_balances();
create function public.payroll_balances()
returns table (
  employee_id uuid,
  full_name   text,
  job_title   text,
  days        numeric,
  base        numeric,
  extra       numeric,
  deduct      numeric,
  accrued     numeric,
  -- เงินที่ออกก่อนที่อนุมัติแล้วและยังไม่คืน (โบนัสไม่ค้างเพราะเกิดตอนจ่ายเลย)
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
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) acc on true
  left join lateral (
    select
      sum(ad.amount) filter (where ad.kind = 'add')    as extra,
      sum(ad.amount) filter (where ad.kind = 'deduct') as deduct
    from public.attendance_adjustments ad
    join public.attendance a on a.id = ad.attendance_id
    where a.employee_id = e.id
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) adj on true
  left join lateral (
    -- 🔴 `approved` เท่านั้น — รายการที่รออนุมัติยังไม่ใช่เงินที่บริษัทติด
    select sum(t.amount) as total
    from public.transactions t
    where t.owed_employee_id = e.id
      and t.status = 'approved'
      and t.settled_run_id is null
  ) ow on true
  left join lateral (
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = e.id
      and ad.payroll_run_id is null
      and ad.status = 'approved'
  ) adv on true
  where (select public.is_owner())
    and (coalesce(acc.total, 0) <> 0 or coalesce(adv.total, 0) <> 0 or coalesce(ow.total, 0) <> 0)
  order by e.full_name;
$$;

revoke execute on function public.payroll_balances() from public, anon;
grant execute on function public.payroll_balances() to authenticated;

create or replace function public.payroll_outstanding()
returns table (
  people   int,
  accrued  numeric,
  advanced numeric,
  balance  numeric
)
language sql
stable
set search_path = ''
as $$
  select
    count(*)::int,
    coalesce(sum(b.accrued), 0),
    coalesce(sum(b.advanced), 0),
    coalesce(sum(b.balance), 0)
  from public.payroll_balances() b
$$;

revoke execute on function public.payroll_outstanding() from public, anon;
grant execute on function public.payroll_outstanding() to authenticated;

-- สูตรรายคนตัวเดียวกัน (ใช้ตอนเตือนเบิกเกิน + กล่องลบคนงาน)
create or replace function public.employee_balance_raw(p_employee uuid)
returns table (accrued numeric, advanced numeric, balance numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(acc.total, 0),
    coalesce(adv.total, 0),
    coalesce(acc.total, 0) + coalesce(ow.total, 0) - coalesce(adv.total, 0)
  from (
    select sum(aw.amount) as total
    from public.attendance a
    join public.attendance_wages aw on aw.attendance_id = a.id
    where a.employee_id = p_employee
      and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)
  ) acc
  cross join (
    select sum(t.amount) as total
    from public.transactions t
    where t.owed_employee_id = p_employee
      and t.status = 'approved'
      and t.settled_run_id is null
  ) ow
  cross join (
    select sum(ad.amount - ad.deducted_amount) as total
    from public.advances ad
    where ad.employee_id = p_employee
      and ad.payroll_run_id is null
      and ad.status = 'approved'
  ) adv;
$$;

revoke execute on function public.employee_balance_raw(uuid) from public, anon, authenticated;

-- ── 5 · ปิดรอบจ่าย ─────────────────────────────────────────────────────
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

revoke execute on function public.close_payroll_run(uuid) from public, anon;
grant execute on function public.close_payroll_run(uuid) to authenticated;

-- ── 6 · จ่ายรายคน: + โบนัส + ยอดที่เจ้าของเห็นก่อนกด ──────────────────
-- 🔴 เปลี่ยนพารามิเตอร์ = ต้อง drop ตัวเดิม ไม่งั้นได้สองฟังก์ชันชื่อเดียวกัน
-- แล้วตัวเก่า (ที่ไม่รู้จักโบนัส) ยังถูกเรียกได้อยู่เงียบ ๆ
drop function if exists public.pay_employee_wage(uuid);
drop function if exists public.pay_employee_wage(uuid, numeric, numeric);
create function public.pay_employee_wage(
  p_employee uuid,
  p_bonus    numeric default 0,
  -- เงินสดที่เจ้าของเห็นบนจอก่อนกด · ไม่ตรง = มีคนลงชื่อ/อนุมัติแทรกเข้ามา
  -- → ปฏิเสธ ไม่จ่ายตัวเลขที่เจ้าของไม่ได้ยืนยัน
  p_expected numeric default null
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
    and not public.attendance_paid(a.employee_id, a.work_date, a.site_id);

  select sum(t.amount) into v_owed
  from public.transactions t
  where t.owed_employee_id = p_employee
    and t.status = 'approved'
    and t.settled_run_id is null;

  if v_from is null and coalesce(v_owed, 0) = 0 and v_bonus = 0 then
    raise exception 'NOTHING_TO_PAY: คนนี้ไม่มียอดค้างจ่าย';
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

    perform set_config('app.payroll_settle', '1', true);
    insert into public.transactions
      (kind, site_id, category_id, amount, txn_date, pay_method, status, note,
       owed_employee_id, owed_kind)
    values
      ('expense', null, v_cat, v_bonus, v_today, 'cash', 'approved', 'โบนัส — ' || v_name,
       p_employee, 'bonus');
    perform set_config('app.payroll_settle', '', true);
  end if;

  insert into public.payroll_runs (period_start, period_end, site_id, employee_id, covers_work)
  values (coalesce(v_from, v_today), coalesce(v_to, v_today), null, p_employee, v_from is not null)
  returning id into v_run;

  perform public.close_payroll_run(v_run);

  return query
    select v_run, l.days, l.accrued, l.reimbursed, l.bonus, l.advance_deducted, l.net_paid
    from public.payroll_lines l
    where l.run_id = v_run and l.employee_id = p_employee;
end $$;

revoke execute on function public.pay_employee_wage(uuid, numeric, numeric) from public, anon;
grant execute on function public.pay_employee_wage(uuid, numeric, numeric) to authenticated;

-- ── 7 · จ่ายทุกคนในทรานแซกชันเดียว ─────────────────────────────────
-- ใครคนหนึ่งล้ม = ไม่มีใครถูกจ่ายเลย · ข้อความบอกชื่อคนที่ติด
-- p_items = [{ "employee_id": uuid, "bonus": number, "expected": number }, …]
create or replace function public.pay_employees(p_items jsonb)
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
        (v_item->>'expected')::numeric
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

revoke execute on function public.pay_employees(jsonb) from public, anon;
grant execute on function public.pay_employees(jsonb) to authenticated;

-- ── 8 · รายงาน: แยกคืนเงิน/โบนัสออกจากยอดจ่ายวันจ่ายค่าแรง ──────────
drop function if exists public.report_labor(date, date, uuid);
create function public.report_labor(
  p_from date,
  p_to date,
  p_site uuid default null
)
returns table (
  work_units      numeric,
  work_days       int,
  worker_count    int,
  wage_total      numeric,
  ot_total        numeric,
  advance_paid    numeric,
  -- เงินสดที่ยื่นให้วันจ่ายค่าแรง (รวมคืนเงินที่ออกก่อน + โบนัส หลังหักเบิก)
  payroll_paid    numeric,
  reimbursed_paid numeric,
  bonus_paid      numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(a.work_units, 0),
    coalesce(a.work_days, 0),
    coalesce(a.worker_count, 0),
    coalesce(a.wage_total, 0),
    coalesce(a.ot_total, 0),
    coalesce(v.advance_paid, 0),
    coalesce(r.payroll_paid, 0),
    coalesce(r.reimbursed_paid, 0),
    coalesce(r.bonus_paid, 0)
  from (values (1)) as one(x)
  left join lateral (
    select
      sum(at.work_units) as work_units,
      count(distinct at.work_date)::int as work_days,
      count(distinct at.employee_id)::int as worker_count,
      sum(aw.amount) as wage_total,
      sum(aw.ot_amount) as ot_total
    from public.attendance at
    join public.attendance_wages aw on aw.attendance_id = at.id
    where at.work_date between p_from and p_to
      and (p_site is null or at.site_id = p_site)
  ) a on true
  left join lateral (
    select sum(ad.amount) as advance_paid
    from public.advances ad
    where ad.advance_date between p_from and p_to
      and ad.status = 'approved'
      and (p_site is null or ad.site_id = p_site)
  ) v on true
  left join lateral (
    select
      sum(pr.total_paid) as payroll_paid,
      sum((select coalesce(sum(l.reimbursed), 0) from public.payroll_lines l where l.run_id = pr.id)) as reimbursed_paid,
      sum((select coalesce(sum(l.bonus), 0) from public.payroll_lines l where l.run_id = pr.id)) as bonus_paid
    from public.payroll_runs pr
    where pr.status = 'closed'
      and pr.period_end between p_from and p_to
      and (p_site is null or pr.site_id = p_site)
  ) r on true
  where (select public.is_owner());
$$;

revoke execute on function public.report_labor(date, date, uuid) from public, anon;
grant execute on function public.report_labor(date, date, uuid) to authenticated;

-- ── 9 · ลบคนงาน: ห้ามถ้าบริษัทยังผูกเงินกับเขาอยู่ ─────────────────────
create or replace function public.delete_employee(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name    text;
  v_lines   int;
  v_days    numeric;
  v_unpaid  numeric;
  v_adv     numeric;
  v_att     int;
  v_advn    int;
  v_owed    numeric;
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN: เฉพาะเจ้าของเท่านั้นที่ลบคนงานได้';
  end if;

  select e.full_name into v_name from public.employees e where e.id = p_id;
  if v_name is null then
    raise exception 'NOT_FOUND: ไม่พบคนงานคนนี้';
  end if;

  select count(*) into v_lines from public.payroll_lines pl where pl.employee_id = p_id;
  if v_lines > 0 then
    raise exception 'EMPLOYEE_IN_PAYROLL: คนนี้อยู่ในรอบจ่ายค่าแรงที่ปิดแล้ว % รอบ', v_lines;
  end if;

  -- 🔴 R15: เงินที่เขาออกให้บริษัทก่อน — ลบคนแล้วหนี้ของบริษัทต่อเขาหายเงียบ
  select coalesce(sum(t.amount), 0) into v_owed
  from public.transactions t where t.owed_employee_id = p_id;
  if v_owed > 0 then
    raise exception 'EMPLOYEE_OWED: คนนี้ออกเงินให้บริษัทไว้ ฿% ยังผูกอยู่กับรายจ่าย — ปิดใช้งานแทน',
      to_char(v_owed, 'FM999,999,990');
  end if;

  select coalesce(sum(at.work_units), 0), count(*)
    into v_days, v_att
  from public.attendance at where at.employee_id = p_id;
  select b.accrued into v_unpaid from public.employee_balance(p_id) b;
  select coalesce(sum(ad.amount), 0), count(*)
    into v_adv, v_advn
  from public.advances ad where ad.employee_id = p_id;

  delete from public.advances   where employee_id = p_id;
  delete from public.attendance where employee_id = p_id;
  delete from public.employees  where id = p_id;

  return jsonb_build_object(
    'ok', true, 'full_name', v_name,
    'work_days', v_days, 'attendance_rows', v_att,
    'unpaid_wage', v_unpaid, 'advance_amount', v_adv, 'advance_rows', v_advn);
end $$;

revoke execute on function public.delete_employee(uuid) from public, anon;
grant  execute on function public.delete_employee(uuid) to authenticated;
