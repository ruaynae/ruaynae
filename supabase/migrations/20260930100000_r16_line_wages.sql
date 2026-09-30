-- R16 · เมนู 5 "ค่าแรงคงค้าง" + ช่อง "ใครจ่ายเงินไป" ในเมนูคีย์รายจ่าย (คำขอเจ้าของ 30 ก.ย. 2569)
-- · ตัวเลขทุกตัวมาจาก payroll_balances() สูตรเดียวกับหน้า /payroll — ห้ามคิดสูตรใหม่ในบอท
-- · คนงานที่ออกเงินให้ก่อน = transactions.owed_employee_id (R15) · guard_transaction_owed ตั้ง owed_kind ให้

-- ── 1 · ตัวเลือกของเมนูคีย์รายจ่าย + รายชื่อคนงาน ────────────────────────
create or replace function public.bot_expense_options(p_line_user text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._bot_as(p_line_user);
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
                     order by c.sort_order, c.name), '[]'::jsonb)
                     from public.categories c where c.kind = 'expense' and c.is_active),
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name)
                     order by s.name), '[]'::jsonb)
                     from public.sites s where s.status in ('planning', 'active')),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name)
                     order by e.full_name), '[]'::jsonb)
                     from public.employees e where e.is_active));
end $$;

-- ── 2 · บันทึกรายจ่าย + คนงานที่ออกเงินให้ก่อน ─────────────────────────
-- 🔴 เปลี่ยนพารามิเตอร์ = drop ตัวเดิมก่อน ไม่งั้นได้สองฟังก์ชันชื่อเดียวกัน
drop function if exists public.bot_create_expense(text, uuid, numeric, date, uuid, text, text, uuid);
create or replace function public.bot_create_expense(
  p_line_user     text,
  p_category      uuid,
  p_amount        numeric,
  p_date          date,
  p_site          uuid    default null,
  p_pay_method    text    default 'transfer',
  p_note          text    default null,
  p_client_ref    uuid    default null,
  p_owed_employee uuid    default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_cat   text;
  v_site  text;
  v_emp   text;
begin
  perform public._bot_as(p_line_user);

  if p_date > v_today then
    raise exception 'DATE_FUTURE: บันทึกรายการของวันในอนาคตไม่ได้';
  end if;
  select c.name into v_cat from public.categories c
   where c.id = p_category and c.kind = 'expense' and c.is_active;
  if v_cat is null then
    return jsonb_build_object('ok', false, 'code', 'CATEGORY_INVALID');
  end if;
  if p_site is not null then
    select s.name into v_site from public.sites s where s.id = p_site;
    if v_site is null then
      return jsonb_build_object('ok', false, 'code', 'SITE_INVALID');
    end if;
  end if;
  if p_owed_employee is not null then
    select e.full_name into v_emp from public.employees e where e.id = p_owed_employee and e.is_active;
    if v_emp is null then
      return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_INVALID');
    end if;
  end if;

  if p_client_ref is not null then
    select t.id into v_id from public.transactions t where t.client_ref = p_client_ref;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'transaction_id', v_id,
                                'category', v_cat, 'site', v_site, 'employee', v_emp);
    end if;
  end if;

  insert into public.transactions (
    kind, site_id, category_id, amount, txn_date, pay_method,
    note, client_ref, status, via_line, owed_employee_id)
  values (
    'expense', p_site, p_category, p_amount, p_date,
    coalesce(p_pay_method, 'transfer')::public.pay_method,
    nullif(btrim(coalesce(p_note, '')), ''), p_client_ref, 'approved', true, p_owed_employee)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'transaction_id', v_id,
                            'category', v_cat, 'site', v_site, 'employee', v_emp);

exception when unique_violation then
  select t.id into v_id from public.transactions t where t.client_ref = p_client_ref;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction_id', v_id,
                              'category', v_cat, 'site', v_site, 'employee', v_emp);
  end if;
  raise;
end $$;

-- ── 3 · เมนู 5 · รายชื่อคนที่มียอดค้าง ────────────────────────────────
create or replace function public.bot_wage_list(p_line_user text)
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
    from public.payroll_balances() b);
end $$;

-- ── 4 · เมนู 5 · รายละเอียดของคนหนึ่งคน (ข้อมูลของใบสรุปรูปภาพ) ──────────
-- ขอบเขตเดียวกับ payroll_balances(): วันที่ยังไม่จ่าย · เบิกที่อนุมัติแล้วและยังหักไม่ครบ ·
-- เงินที่ออกก่อนที่อนุมัติแล้วและยังไม่คืน
create or replace function public.bot_wage_detail(p_line_user text, p_employee uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  perform public._bot_as(p_line_user);
  select * into b from public.payroll_balances() x where x.employee_id = p_employee;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOTHING');
  end if;

  return jsonb_build_object(
    'ok', true,
    'company', (select br.company_name from public.branding br limit 1),
    'name', b.full_name, 'job', b.job_title,
    'days', b.days, 'base', b.base, 'extra', b.extra, 'deduct', b.deduct,
    'accrued', b.accrued, 'owed', b.owed, 'advanced', b.advanced, 'balance', b.balance,
    'from', (select min(a.work_date) from public.attendance a
              where a.employee_id = p_employee
                and not public.attendance_paid(a.employee_id, a.work_date, a.site_id)),
    'to',   (select max(a.work_date) from public.attendance a
              where a.employee_id = p_employee
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
        order by t.txn_date, t.created_at
        limit 40
      ) x), '[]'::jsonb),
    'owed_count', (select count(*) from public.transactions t
                    where t.owed_employee_id = p_employee and t.status = 'approved'
                      and t.settled_run_id is null),
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
        order by ad.advance_date, ad.id
        limit 40
      ) x), '[]'::jsonb),
    'advance_count', (select count(*) from public.advances ad
                       where ad.employee_id = p_employee and ad.payroll_run_id is null
                         and ad.status = 'approved'));
end $$;

-- ── 5 · สิทธิ์: service_role เท่านั้น (เหมือน bot_* ทุกตัว) ────────────
revoke execute on function public.bot_expense_options(text) from public, anon, authenticated;
grant  execute on function public.bot_expense_options(text) to service_role;
revoke execute on function public.bot_create_expense(text, uuid, numeric, date, uuid, text, text, uuid, uuid) from public, anon, authenticated;
grant  execute on function public.bot_create_expense(text, uuid, numeric, date, uuid, text, text, uuid, uuid) to service_role;
revoke execute on function public.bot_wage_list(text) from public, anon, authenticated;
grant  execute on function public.bot_wage_list(text) to service_role;
revoke execute on function public.bot_wage_detail(text, uuid) from public, anon, authenticated;
grant  execute on function public.bot_wage_detail(text, uuid) to service_role;
