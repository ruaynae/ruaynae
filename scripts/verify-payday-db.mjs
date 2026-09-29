#!/usr/bin/env node
/**
 * verify-payday-db.mjs — ปิดแถว R15-*-DB / R15-C ใน docs/test-plan/R15-payday-slip.md
 *
 * 🔴 ไม่ทิ้งอะไรไว้ในฐานเลย — ทุกอย่างอยู่ใน `do` block ที่จบด้วย `raise exception`
 * (§17 ข้อ 30) · fixture · รอบจ่าย · รายจ่าย · audit_log ม้วนกลับพร้อมกัน
 * · คำสั่ง **สำเร็จ** แทนที่จะโยน exception = แดงทันที (รายงานไม่ถูกส่งกลับ)
 *
 * ใช้:
 *   node scripts/verify-payday-db.mjs                    # หลัง apply migration แล้ว
 *   node scripts/verify-payday-db.mjs --with-migration   # ซ้อม: migration + ตรวจ แล้วม้วนกลับทั้งหมด
 */
import { readFileSync } from 'node:fs'

const MIGRATION = 'supabase/migrations/20260929090000_r15_payday_slip.sql'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
)
const REF = env.SUPABASE_PROJECT_REF
const hostRef = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!REF || hostRef !== REF) {
  throw new Error(`เป้าหมายไม่ตรงกัน: PROJECT_REF=${REF} แต่ URL ชี้ไป ${hostRef}`)
}

const run = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (r.ok) return { rolledBack: false, message: text }
  let message = text
  try { message = JSON.parse(text)?.message ?? text } catch { /* ข้อความดิบก็พอ */ }
  return { rolledBack: true, message }
}

// ── ตัวช่วยใน pg_temp (ม้วนกลับไปพร้อมกัน) ─────────────────────────────
const HELPERS = String.raw`
create function pg_temp.ln(ok boolean, id text, what text, detail text default '')
returns text language sql immutable as $f$
  select case when coalesce(ok, false) then '✅ ' || id || ' ' || what
              else '❌ ' || id || ' ' || what || ' — ' || coalesce(detail, 'null') end || E'\n'
$f$;
`

const BLOCK = String.raw`
do $check$
declare
  v_out   text := E'\n── R15 บนฐานจริง ─────────────────────────────────\n';
  v_owner uuid;
  v_sup   uuid;
  v_site  uuid;
  v_cat   uuid;
  v_inc   uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid; e8 uuid; e9 uuid;
  a1 uuid; a2 uuid;
  t1 uuid; t2 uuid; t3 uuid;
  v_run   uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  l       record;
  b       record;
  v_num   numeric;
  v_num2  numeric;
  v_int   int;
  v_bool  boolean;
  v_txt   text;
  v_js    jsonb;
begin
  perform pg_catalog.set_config('search_path', 'public', true);

  select id into v_owner from public.profiles where role = 'owner' and is_active limit 1;
  select id into v_sup   from public.profiles where role = 'site_supervisor' and is_active limit 1;
  select id into v_cat   from public.categories where kind = 'expense' and is_active order by sort_order limit 1;
  select id into v_inc   from public.categories where kind = 'income' and is_active order by sort_order limit 1;

  -- ── fixture (superuser · ม้วนกลับทั้งหมด) ──────────────────────────
  insert into public.sites(name, status) values ('R15 ตรวจชั่วคราว', 'active') returning id into v_site;
  insert into public.site_supervisors(site_id, profile_id, effective_from) values (v_site, v_sup, v_today - 30);

  insert into public.employees(full_name) values ('R15-E1') returning id into e1;
  insert into public.employees(full_name) values ('R15-E2') returning id into e2;
  insert into public.employees(full_name) values ('R15-E3') returning id into e3;
  insert into public.employees(full_name) values ('R15-E4') returning id into e4;
  insert into public.employees(full_name) values ('R15-E5') returning id into e5;
  insert into public.employees(full_name) values ('R15-E6') returning id into e6;
  insert into public.employees(full_name) values ('R15-E7') returning id into e7;
  insert into public.employees(full_name) values ('R15-E8') returning id into e8;
  insert into public.employees(full_name) values ('R15-E9') returning id into e9;
  insert into public.employee_wages(employee_id, wage_type, daily_rate)
    select x, 'daily', 500 from unnest(array[e1,e2,e3,e4,e5,e6,e7,e8,e9]) x;

  insert into public.attendance(work_date, site_id, employee_id, work_units) values
    (v_today - 2, v_site, e1, 1), (v_today - 1, v_site, e1, 1),
    (v_today - 2, v_site, e2, 1), (v_today - 1, v_site, e2, 1),
    (v_today - 1, v_site, e4, 1),
    (v_today - 1, v_site, e5, 1),
    (v_today - 1, v_site, e7, 1);
  -- e3 · e6 · e8 ไม่มีวันทำงานค้างเลย (โดยตั้งใจ)

  -- ── สวมสิทธิ์เจ้าของ ─────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- เบี้ย/ค่าหักของ e1: ตจว. 200 ทั้งสองวัน · มาสาย 50 วันเดียว → 1000 + 400 − 50 = 1350
  insert into public.attendance_adjustments(attendance_id, name, kind, amount)
    select a.id, 'เบี้ยเลี้ยงตจว.', 'add', 200 from public.attendance a where a.employee_id = e1;
  insert into public.attendance_adjustments(attendance_id, name, kind, amount)
    select a.id, 'มาสาย', 'deduct', 50 from public.attendance a where a.employee_id = e1 and a.work_date = v_today - 1;

  -- เบิกสามใบของ e1 = 1,700 (เจ้าของคีย์ = approved) → หักได้แค่ 1,350 · ใบสุดท้ายค้าง
  insert into public.advances(employee_id, amount, advance_date) values
    (e1, 300, v_today - 5), (e1, 400, v_today - 4), (e1, 1000, v_today - 3);

  -- ════ ก้อน A ════════════════════════════════════════════════════
  select * into l from public.pay_employee_wage(e1);
  select pl.* into b from public.payroll_lines pl where pl.run_id = l.run_id;
  v_js := b.breakdown;

  v_out := v_out || pg_temp.ln(
    (v_js->'base'->>'units')::numeric = 2 and (v_js->'base'->>'amount')::numeric = 1000
      and jsonb_array_length(v_js->'adjustments') = 2
      and exists (select 1 from jsonb_array_elements(v_js->'adjustments') x
                  where x->>'name' = 'เบี้ยเลี้ยงตจว.' and (x->>'times')::int = 2 and (x->>'total')::numeric = 400
                    and jsonb_array_length(x->'dates') = 2),
    'R15-A-DB-01', 'breakdown มีค่าจ้างฐาน 2 แรง ฿1,000 + ตจว. ×2 ฿400 พร้อมวันที่',
    v_js::text);

  select (v_js->'base'->>'amount')::numeric
         + coalesce(sum((x->>'total')::numeric) filter (where x->>'kind' = 'add'), 0)
         - coalesce(sum((x->>'total')::numeric) filter (where x->>'kind' = 'deduct'), 0)
    into v_num from jsonb_array_elements(v_js->'adjustments') x;
  v_out := v_out || pg_temp.ln(v_num = b.accrued and b.accrued = 1350,
    'R15-A-DB-02', 'base + เบี้ย − หัก = accrued ฿1,350 เป๊ะ', format('%s vs %s', v_num, b.accrued));

  select sum((x->>'taken')::numeric), count(*),
         bool_or((x->>'amount')::numeric = 1000 and (x->>'taken')::numeric = 650)
    into v_num, v_int, v_bool from jsonb_array_elements(v_js->'advances') x;
  v_out := v_out || pg_temp.ln(v_int = 3 and v_num = b.advance_deducted and b.advance_deducted = 1350 and v_bool
      and b.net_paid = 0,
    'R15-A-DB-03', 'หักเบิก 3 ใบ Σ ฿1,350 · ใบ ฿1,000 หักรอบนี้ ฿650 · เงินสด ฿0',
    format('n=%s sum=%s ded=%s net=%s', v_int, v_num, b.advance_deducted, b.net_paid));

  begin
    update public.payroll_lines set breakdown = '{}'::jsonb where id = b.id;
    v_out := v_out || pg_temp.ln(false, 'R15-A-DB-06', 'แก้ breakdown หลังจ่ายต้องถูกปฏิเสธ', 'แก้ได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%PAYROLL_CLOSED%', 'R15-A-DB-06', 'แก้ breakdown หลังจ่าย → PAYROLL_CLOSED', sqlerrm);
  end;

  select count(*) into v_int from public.payroll_lines
    where breakdown is null and created_at < now() - interval '1 minute';
  v_out := v_out || pg_temp.ln(true, 'R15-A-DB-05', format('แถวเก่าไม่ถูก backfill (%s แถว breakdown = null)', v_int));

  -- ════ ก้อน B · สวมสิทธิ์หัวหน้าโครงการ ═══════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);

  begin
    insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, note, owed_employee_id)
      values ('expense', v_site, v_cat, 300, v_today, 'pending', 'น้ำแข็ง', e2) returning id into t1;
    select status::text || '/' || owed_kind::text into v_txt from public.transactions where id = t1;
    v_out := v_out || pg_temp.ln(v_txt = 'pending/reimburse', 'R15-B-DB-01', 'หัวหน้าโครงการคีย์ "ลูกน้องออกเงินก่อน" → pending/reimburse', v_txt);
  exception when others then
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-01', 'หัวหน้าโครงการคีย์ได้', sqlerrm);
  end;

  begin
    insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, owed_employee_id)
      values ('expense', null, v_cat, 100, v_today, 'pending', e2);
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-02', 'ของส่วนกลางต้องถูกปฏิเสธ', 'บันทึกได้');
  exception when others then
    v_out := v_out || pg_temp.ln(true, 'R15-B-DB-02', 'หัวหน้าโครงการคีย์ส่วนกลาง → ปฏิเสธ (' || left(sqlerrm, 40) || ')');
  end;

  begin
    insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, owed_employee_id, owed_kind)
      values ('expense', v_site, v_cat, 100, v_today, 'pending', e2, 'bonus');
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-05', 'ตั้ง owed_kind=bonus เองต้องถูกปฏิเสธ', 'บันทึกได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%OWED_FORBIDDEN%', 'R15-B-DB-05', 'หัวหน้าโครงการตั้งโบนัสเอง → OWED_FORBIDDEN', sqlerrm);
  end;

  -- ════ สวมสิทธิ์เจ้าของ ═══════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  begin
    insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, income_kind, owed_employee_id)
      values ('income', v_site, v_inc, 100, v_today, 'approved', 'other', e2);
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-04', 'owed บนรายรับต้องถูกปฏิเสธ', 'บันทึกได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%transactions_owed_expense%', 'R15-B-DB-04', 'owed บนรายรับ → check transactions_owed_expense', sqlerrm);
  end;

  select owed into v_num from public.payroll_balances() where employee_id = e2;
  v_out := v_out || pg_temp.ln(coalesce(v_num, 0) = 0, 'R15-B-DB-06', 'รายการ pending ยังไม่เป็นเงินที่บริษัทติด (owed = 0)', v_num::text);

  select count(*) into v_int from public.transactions where site_id = v_site;
  update public.transactions set status = 'approved' where id = t1;
  select owed, balance into v_num, v_num2 from public.payroll_balances() where employee_id = e2;
  v_out := v_out || pg_temp.ln(v_num = 300 and v_num2 = 1300, 'R15-B-DB-07', 'อนุมัติแล้ว owed ฿300 · คงเหลือ ฿1,000 + ฿300', format('owed=%s bal=%s', v_num, v_num2));

  select * into l from public.pay_employee_wage(e2);
  select settled_run_id = l.run_id into v_bool from public.transactions where id = t1;
  v_out := v_out || pg_temp.ln(l.reimbursed = 300 and l.paid = 1300 and v_bool,
    'R15-B-DB-08', 'จ่าย: ค่าแรง ฿1,000 + คืน ฿300 = เงินสด ฿1,300 · รายการถูกตีตรา', format('reimb=%s paid=%s settled=%s', l.reimbursed, l.paid, v_bool));

  select count(*) into v_num from public.transactions where site_id = v_site;
  v_out := v_out || pg_temp.ln(v_num = v_int, 'R15-B-DB-11', 'จ่ายแล้วไม่มีรายจ่ายใหม่เกิดในโครงการ (ต้นทุนไม่นับซ้ำ)', format('%s → %s', v_int, v_num));

  select breakdown into v_js from public.payroll_lines where run_id = l.run_id;
  v_out := v_out || pg_temp.ln(jsonb_array_length(v_js->'owed') = 1 and (v_js->'owed'->0->>'note') = 'น้ำแข็ง',
    'R15-B-UI-06', 'breakdown.owed มีรายการน้ำแข็ง (ใบสรุปอ่านจากตรงนี้)', v_js->>'owed');

  begin
    update public.transactions set amount = 999 where id = t1;
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-12', 'แก้ยอดรายการที่คืนเงินแล้วต้องถูกปฏิเสธ', 'แก้ได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%PAYROLL_CLOSED%', 'R15-B-DB-12', 'เจ้าของแก้ยอดรายการที่คืนเงินแล้ว → PAYROLL_CLOSED', sqlerrm);
  end;
  begin
    delete from public.transactions where id = t1;
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-12b', 'ลบรายการที่คืนเงินแล้วต้องถูกปฏิเสธ', 'ลบได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%PAYROLL_CLOSED%', 'R15-B-DB-12b', 'เจ้าของลบรายการที่คืนเงินแล้ว → PAYROLL_CLOSED', sqlerrm);
  end;
  begin
    update public.transactions set note = 'น้ำแข็ง 2 ถุง' where id = t1;
    v_out := v_out || pg_temp.ln(true, 'R15-B-DB-12c', 'แก้รายละเอียดของรายการที่คืนเงินแล้วยังได้');
  exception when others then
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-12c', 'แก้รายละเอียดต้องได้', sqlerrm);
  end;
  begin
    update public.transactions set settled_run_id = null where id = t1;
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-05b', 'ถอดตรา settled เองต้องถูกปฏิเสธ', 'ถอดได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%OWED_FORBIDDEN%' or sqlerrm like '%PAYROLL_CLOSED%', 'R15-B-DB-05b', 'ถอดตรา settled เอง → ปฏิเสธ', sqlerrm);
  end;

  -- กันจ่ายซ้ำของรอบปกติยังทำงาน
  begin
    delete from public.attendance where employee_id = e2 and work_date = v_today - 2;
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-18', 'ลบวันที่จ่ายไปแล้วต้องถูกปฏิเสธ', 'ลบได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%PAYROLL_CLOSED%',
      'R15-B-DB-18', 'วันที่จ่ายไปแล้วยังล็อกเหมือนเดิม (ลบ → PAYROLL_CLOSED)', sqlerrm);
  end;

  -- B-DB-09 · e3: ไม่มีค่าแรงค้าง · เบิกเกิน 1,000 · ออกเงินก่อน 300 (เจ้าของคีย์ = approved)
  insert into public.advances(employee_id, amount, advance_date) values (e3, 1000, v_today - 3) returning id into a1;
  insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, note, owed_employee_id)
    values ('expense', v_site, v_cat, 300, v_today, 'approved', 'ค่าส่งหิน', e3) returning id into t2;
  begin
    select * into l from public.pay_employee_wage(e3);
    select deducted_amount into v_num from public.advances where id = a1;
    select balance into v_num2 from public.payroll_balances() where employee_id = e3;
    select covers_work into v_bool from public.payroll_runs where id = l.run_id;
    v_out := v_out || pg_temp.ln(l.deducted = 300 and l.paid = 0 and v_num = 300 and v_num2 = -700 and not v_bool,
      'R15-B-DB-09', 'ไม่มีค่าแรงค้าง: คืน ฿300 หักหนี้ · เงินสด ฿0 · ยังติดลบ ฿700 · รอบไม่ครอบวันทำงาน',
      format('ded=%s paid=%s adv=%s bal=%s covers=%s', l.deducted, l.paid, v_num, v_num2, v_bool));
  exception when others then
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-09', 'จ่ายคนที่มีแต่เงินที่ออกก่อนต้องได้', sqlerrm);
  end;

  -- 🔴 กับดัก: รอบของ e3 มีช่วง "วันนี้" — ลงชื่อวันนี้ต้องยังได้และยังไม่ถูกนับว่าจ่ายแล้ว
  begin
    insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, e3, 1);
    select accrued into v_num from public.payroll_balances() where employee_id = e3;
    v_out := v_out || pg_temp.ln(v_num = 500, 'R15-B-DB-17', 'รอบคืนเงินไม่ล็อกวัน: ลงชื่อวันนี้ได้ และค่าแรง ฿500 ยังค้างจ่าย', v_num::text);
  exception when others then
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-17', 'ลงชื่อหลังรอบคืนเงินต้องได้', sqlerrm);
  end;

  -- B-DB-10 · e4: ค่าแรง 500 + ออกก่อน 300 · เบิก 2,000 → หัก 800 · ใบค้าง 1,200
  insert into public.advances(employee_id, amount, advance_date) values (e4, 2000, v_today - 3) returning id into a2;
  insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, owed_employee_id)
    values ('expense', v_site, v_cat, 300, v_today, 'approved', e4);
  select * into l from public.pay_employee_wage(e4);
  select amount - deducted_amount into v_num from public.advances where id = a2;
  v_out := v_out || pg_temp.ln(l.deducted = 800 and l.paid = 0 and v_num = 1200,
    'R15-B-DB-10', 'ค่าแรง ฿500 + คืน ฿300 หักเบิก ฿800 · ใบเหลือ ฿1,200', format('ded=%s paid=%s left=%s', l.deducted, l.paid, v_num));

  -- B-DB-15 · รายงานแยกเงินคืน
  -- รายงานนับรอบตาม period_end · รอบของ e2/e4 จบเมื่อวาน
  select reimbursed_paid into v_num from public.report_labor(v_today - 7, v_today, null);
  v_out := v_out || pg_temp.ln(v_num >= 900, 'R15-B-DB-15', 'report_labor.reimbursed_paid นับเงินคืนของสัปดาห์นี้ (≥ ฿900)', v_num::text);

  -- ════ ก้อน C · โบนัส ═════════════════════════════════════════════
  begin
    perform * from public.pay_employee_wage(e5, -1);
    v_out := v_out || pg_temp.ln(false, 'R15-C-07', 'โบนัสติดลบต้องถูกปฏิเสธ', 'จ่ายได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%BONUS_INVALID%', 'R15-C-07', 'โบนัสติดลบ → BONUS_INVALID', sqlerrm);
  end;

  begin
    perform * from public.pay_employee_wage(e5, 5000, 1234);
    v_out := v_out || pg_temp.ln(false, 'R15-A-ALL-05', 'ยอดที่เห็นไม่ตรงต้องถูกปฏิเสธ', 'จ่ายได้');
  exception when others then
    select count(*) into v_int from public.transactions where owed_employee_id = e5;
    v_out := v_out || pg_temp.ln(sqlerrm like '%BALANCE_CHANGED%', 'R15-A-ALL-05', 'ยอดเปลี่ยนระหว่างเปิดจอ → BALANCE_CHANGED', sqlerrm);
    v_out := v_out || pg_temp.ln(v_int = 0, 'R15-C-03', 'จ่ายล้ม → ไม่มีรายการโบนัสค้าง', v_int::text);
  end;

  select * into l from public.pay_employee_wage(e5, 5000, 5500);
  select count(*), bool_and(t.status = 'approved' and t.owed_kind = 'bonus' and t.site_id is null
                            and t.settled_run_id = l.run_id and c.name = 'โบนัสพนักงาน')
    into v_int, v_bool
    from public.transactions t join public.categories c on c.id = t.category_id
    where t.owed_employee_id = e5;
  v_out := v_out || pg_temp.ln(l.bonus = 5000 and l.paid = 5500 and v_int = 1 and v_bool,
    'R15-C-02', 'โบนัส ฿5,000: รายจ่ายส่วนกลางหมวดโบนัส approved + ตีตรา · เงินสด ฿5,500',
    format('bonus=%s paid=%s n=%s ok=%s', l.bonus, l.paid, v_int, v_bool));

  select is_active into v_bool from public.categories where kind = 'expense' and name = 'โบนัสพนักงาน';
  v_out := v_out || pg_temp.ln(v_bool = false, 'R15-C-08', 'หมวดโบนัสมีอยู่และปิดใช้งาน (ไม่โผล่ในฟอร์ม)', v_bool::text);

  insert into public.advances(employee_id, amount, advance_date) values (e6, 1000, v_today - 3);
  select * into l from public.pay_employee_wage(e6, 3000, 2000);
  v_out := v_out || pg_temp.ln(l.deducted = 1000 and l.paid = 2000,
    'R15-C-04', 'ไม่มีค่าแรงค้าง · เบิกเกิน ฿1,000 + โบนัส ฿3,000 → หัก ฿1,000 จ่าย ฿2,000', format('ded=%s paid=%s', l.deducted, l.paid));

  -- ════ จ่ายทุกคน ════════════════════════════════════════════════════
  begin
    perform * from public.pay_employees(jsonb_build_array(
      jsonb_build_object('employee_id', e7, 'expected', 500),
      jsonb_build_object('employee_id', e8)));
    v_out := v_out || pg_temp.ln(false, 'R15-A-ALL-06', 'คนที่ไม่มีอะไรให้จ่ายต้องทำให้ทั้งก้อนล้ม', 'จ่ายได้');
  exception when others then
    select count(*) into v_int from public.payroll_lines where employee_id = e7;
    v_out := v_out || pg_temp.ln(v_int = 0 and sqlerrm like '%NOTHING_TO_PAY%' and sqlerrm like '%R15-E8%',
      'R15-A-ALL-06', 'คนหนึ่งล้ม → ไม่มีใครถูกจ่าย + ข้อความบอกชื่อ', format('lines e7=%s · %s', v_int, sqlerrm));
  end;

  insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, owed_employee_id)
    values ('expense', v_site, v_cat, 120, v_today, 'approved', e8);
  select count(*), sum(x.paid) into v_int, v_num from public.pay_employees(jsonb_build_array(
      jsonb_build_object('employee_id', e7, 'expected', 500),
      jsonb_build_object('employee_id', e8, 'expected', 120))) x;
  v_out := v_out || pg_temp.ln(v_int = 2 and v_num = 620, 'R15-A-ALL-10', 'จ่ายสองคนในคำสั่งเดียว ฿500 + ฿120', format('n=%s sum=%s', v_int, v_num));

  -- ════ B-DB-13 · B-DB-14 ═════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, owed_employee_id)
    values ('expense', v_site, v_cat, 450, v_today, 'pending', e9) returning id into t3;
  begin
    perform * from public.pay_employees(jsonb_build_array(jsonb_build_object('employee_id', e9)));
    v_out := v_out || pg_temp.ln(false, 'R15-A-ALL-08', 'หัวหน้าโครงการจ่ายเงินต้องไม่ได้', 'จ่ายได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%FORBIDDEN%', 'R15-A-ALL-08', 'หัวหน้าโครงการเรียก pay_employees → FORBIDDEN', sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  update public.transactions set status = 'rejected', rejected_reason = 'ไม่มีบิล' where id = t3;
  select count(*) into v_int from public.payroll_balances() where employee_id = e9;
  v_out := v_out || pg_temp.ln(v_int = 0, 'R15-B-DB-13', 'รายการที่ถูกตีกลับไม่เข้ายอดที่บริษัทติด', v_int::text);

  begin
    perform public.delete_employee(e9);
    v_out := v_out || pg_temp.ln(false, 'R15-B-DB-14', 'ลบคนที่มีรายการออกเงินก่อนผูกอยู่ต้องไม่ได้', 'ลบได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%EMPLOYEE_OWED%', 'R15-B-DB-14', 'ลบคนที่ผูกเงินที่ออกก่อน → EMPLOYEE_OWED', sqlerrm);
  end;

  -- overdrawn_employees ห่อ payroll_balances ตัวใหม่ได้ (ไม่พังหลัง drop/create)
  select count(*) into v_int from public.overdrawn_employees() where employee_id in (e3);
  v_out := v_out || pg_temp.ln(v_int = 1, 'R15-B-DB-19', 'overdrawn_employees ยังทำงานและเห็น e3 ติดลบ ฿700', v_int::text);

  execute 'reset role';
  raise exception '%', v_out;
end
$check$;
`

const withMigration = process.argv.includes('--with-migration')
const sql = (withMigration ? readFileSync(MIGRATION, 'utf8') + '\n' : '') + HELPERS + BLOCK

const { rolledBack, message } = await run(sql)
// 🔴 ใช้ process.exitCode ไม่ใช่ process.exit() — บน Windows การตัดจบทันทีหลัง fetch
// ทำให้ libuv assert ล้ม (exit 127) แล้วรหัสออกไม่ได้บอกผลตรวจจริง
if (!rolledBack) {
  console.log('❌ คำสั่งสำเร็จแทนที่จะม้วนกลับ — รายงานไม่ถูกส่งกลับ และอาจมีของค้างในฐาน')
  process.exitCode = 1
} else {
  const report = message.replace(/^[\s\S]*?P0001:\s*/, '').replace(/\n*CONTEXT:[\s\S]*$/, '')
  console.log(report)
  const fails = (report.match(/❌/g) ?? []).length
  const passes = (report.match(/✅/g) ?? []).length
  if (passes === 0) console.log('❌ ไม่มีแถวไหนรันถึง — error ก่อนเริ่มตรวจ')
  console.log(`\nผ่าน ${passes} · ตก ${fails}${withMigration ? ' · (ซ้อมพร้อม migration แล้วม้วนกลับ)' : ''}`)
  process.exitCode = fails || passes === 0 ? 1 : 0
}
