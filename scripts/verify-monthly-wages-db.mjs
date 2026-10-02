#!/usr/bin/env node
/**
 * verify-monthly-wages-db.mjs — ค่าแรงรายเดือน (คำขอเจ้าของ 2 ต.ค. 2569)
 * ปิดแถว MW-DB-* ใน docs/test-plan/R17-monthly-wages.md
 *
 * 🔴 ไม่ทิ้งอะไรไว้ในฐานเลย — ทุกอย่างอยู่ใน `do` block ที่จบด้วย `raise exception`
 * (§17 ข้อ 30) · fixture · รอบจ่าย · audit_log ม้วนกลับพร้อมกัน
 *
 * ใช้:
 *   node scripts/verify-monthly-wages-db.mjs                    # หลัง apply migration แล้ว
 *   node scripts/verify-monthly-wages-db.mjs --with-migration   # ซ้อม: migration + ตรวจ แล้วม้วนกลับทั้งหมด
 */
import { readFileSync } from 'node:fs'

const MIGRATION = 'supabase/migrations/20261002090000_monthly_wages.sql'

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

const HELPERS = String.raw`
create function pg_temp.ln(ok boolean, id text, what text, detail text default '')
returns text language sql immutable as $f$
  select case when coalesce(ok, false) then '✅ ' || id || ' ' || what
              else '❌ ' || id || ' ' || what || ' — ' || coalesce(detail, 'null') end || E'\n'
$f$;
`

// ตัวอย่างของเจ้าของ: เดือนที่แล้ว ค่าแรง 10,000 เบิก 12,000 → เบิกล่วงหน้าของเดือนนี้ 2,000
const BLOCK = String.raw`
do $check$
declare
  v_out   text := E'\n── ค่าแรงรายเดือน บนฐานจริง ─────────────────────────\n';
  v_owner uuid;
  v_sup   uuid;
  v_site  uuid;
  v_cat   uuid;
  e1 uuid; e2 uuid; e3 uuid;
  a_big uuid; a_now uuid;
  t_lm uuid; t_now uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_cm    date := date_trunc('month', (now() at time zone 'Asia/Bangkok')::date)::date;
  v_lm    date;
  v_lme   date;
  b       record;
  l       record;
  v_num   numeric;
  v_int   int;
  v_bool  boolean;
begin
  perform pg_catalog.set_config('search_path', 'public', true);
  v_lm  := (v_cm - interval '1 month')::date;
  v_lme := v_cm - 1;

  select id into v_owner from public.profiles where role = 'owner' and is_active limit 1;
  select id into v_sup   from public.profiles where role = 'site_supervisor' and is_active limit 1;
  select id into v_cat   from public.categories where kind = 'expense' and is_active order by sort_order limit 1;

  -- ── fixture (superuser · ม้วนกลับทั้งหมด) ──────────────────────────
  insert into public.sites(name, status) values ('MW ตรวจชั่วคราว', 'active') returning id into v_site;
  insert into public.employees(full_name) values ('MW-E1') returning id into e1;
  insert into public.employees(full_name) values ('MW-E2') returning id into e2;
  insert into public.employees(full_name) values ('MW-E3') returning id into e3;
  insert into public.employee_wages(employee_id, wage_type, daily_rate)
    select x, 'daily', 500 from unnest(array[e1, e2, e3]) x;

  -- e1: เดือนที่แล้ว 20 วัน = 10,000 · เดือนนี้ 1 วัน (วันนี้) = 500
  insert into public.attendance(work_date, site_id, employee_id, work_units)
    select v_lm + i, v_site, e1, 1 from generate_series(0, 19) i;
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, e1, 1);
  -- e2: เดือนที่แล้ว 6 วัน = 3,000 · เดือนนี้ 1 วัน
  insert into public.attendance(work_date, site_id, employee_id, work_units)
    select v_lm + i, v_site, e2, 1 from generate_series(0, 5) i;
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, e2, 1);
  -- e3: เดือนที่แล้ว 2 วัน + เดือนนี้ 1 วัน · จ่ายแบบเดิม (ไม่ส่งวันตัด)
  insert into public.attendance(work_date, site_id, employee_id, work_units) values
    (v_lm + 1, v_site, e3, 1), (v_lm + 2, v_site, e3, 1), (v_today, v_site, e3, 1);

  -- ── สวมสิทธิ์เจ้าของ ─────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into public.advances(employee_id, amount, advance_date) values (e1, 12000, v_lm + 10) returning id into a_big;
  insert into public.advances(employee_id, amount, advance_date) values (e1, 500, v_today) returning id into a_now;
  insert into public.advances(employee_id, amount, advance_date) values (e2, 1000, v_lm + 3), (e2, 5000, v_today);
  insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, owed_employee_id)
    values ('expense', v_site, v_cat, 300, v_lm + 4, 'approved', e2) returning id into t_lm;
  insert into public.transactions(kind, site_id, category_id, amount, txn_date, status, owed_employee_id)
    values ('expense', v_site, v_cat, 200, v_today, 'approved', e2) returning id into t_now;

  -- ════ ใบสรุปของเดือน ═════════════════════════════════════════════
  select * into b from public.payroll_month_balances(v_lm) where employee_id = e1;
  v_out := v_out || pg_temp.ln(b.accrued = 10000 and b.advanced = 12000 and b.carry_in = 0 and b.balance = -2000,
    'MW-DB-01', 'เดือนที่แล้ว: ค่าแรง 10,000 − เบิก 12,000 = เบิกเกิน 2,000 (ไม่นับงาน/เบิกของเดือนนี้)',
    format('%s / %s / %s / %s', b.accrued, b.advanced, b.carry_in, b.balance));

  select * into b from public.payroll_month_balances(v_cm) where employee_id = e1;
  v_out := v_out || pg_temp.ln(b.accrued = 500 and b.advanced = 500 and b.carry_in = 2000 and b.balance = -2000,
    'MW-DB-02', 'เดือนนี้: เบิกเกินของเดือนที่แล้ว 2,000 ยกมาเป็นเบิกล่วงหน้าของเดือนนี้',
    format('%s / %s / %s / %s', b.accrued, b.advanced, b.carry_in, b.balance));

  select * into b from public.payroll_month_balances(v_lm) where employee_id = e2;
  v_out := v_out || pg_temp.ln(b.accrued = 3000 and b.owed = 300 and b.advanced = 1000 and b.balance = 2300,
    'MW-DB-03', 'เดือนที่แล้ว e2: 3,000 + ออกก่อน 300 − เบิก 1,000 = 2,300 (เงินออกก่อน/เบิกของเดือนนี้ไม่นับ)',
    format('%s / %s / %s / %s', b.accrued, b.owed, b.advanced, b.balance));

  select * into b from public.payroll_month_balances(v_cm) where employee_id = e2;
  v_out := v_out || pg_temp.ln(b.earlier_unpaid = 2300 and b.carry_in = 0 and b.balance = 500 + 200 - 5000,
    'MW-DB-04', 'เดือนนี้ e2: ค่าแรงเดือนที่แล้วที่ยังไม่จ่ายแจ้งเป็น earlier_unpaid ไม่รวมในยอด',
    format('%s / %s / %s', b.earlier_unpaid, b.carry_in, b.balance));

  select count(*) into v_int from public.payroll_open_months() m where m in (v_lm, v_cm);
  v_out := v_out || pg_temp.ln(v_int = 2, 'MW-DB-05', 'payroll_open_months มีทั้งเดือนที่แล้วและเดือนนี้', v_int::text);

  -- ════ ปุ่มจ่าย "ถึงสิ้นเดือนที่แล้ว" ══════════════════════════════════
  select * into l from public.pay_employee_wage(e1, 0, 0, v_lme);
  v_out := v_out || pg_temp.ln(l.accrued = 10000 and l.deducted = 10000 and l.paid = 0,
    'MW-DB-06', 'จ่ายถึงสิ้นเดือนที่แล้ว (e1): ค่าแรง 10,000 หักเบิก 10,000 จ่ายสด 0 — งานวันนี้ไม่ถูกนับ',
    format('%s / %s / %s', l.accrued, l.deducted, l.paid));

  select (select deducted_amount from public.advances where id = a_big) = 10000
     and (select deducted_amount from public.advances where id = a_now) = 0
     and (select payroll_run_id from public.advances where id = a_now) is null
    into v_bool;
  v_out := v_out || pg_temp.ln(v_bool, 'MW-DB-07', 'ใบเบิกของเดือนนี้ไม่ถูกแตะ · ใบเดือนที่แล้วค้างหัก 2,000', '');

  select not public.attendance_paid(e1, v_today, v_site)
     and public.attendance_paid(e1, v_lm + 19, v_site)
     and (select through_date from public.payroll_runs where id = l.run_id) = v_lme
    into v_bool;
  v_out := v_out || pg_temp.ln(v_bool, 'MW-DB-08', 'วันทำงานของเดือนนี้ยังไม่ถูกปิด · รอบเก็บวันตัด = สิ้นเดือนที่แล้ว', '');

  select * into b from public.payroll_month_balances(v_cm) where employee_id = e1;
  v_out := v_out || pg_temp.ln(b.carry_in = 2000 and b.balance = -2000,
    'MW-DB-09', 'หลังจ่าย ใบเดือนนี้ยังเห็นเบิกล่วงหน้ายกมา 2,000 เท่าเดิม (ตัวเลขไม่กระโดด)',
    format('%s / %s', b.carry_in, b.balance));

  select * into b from public.payroll_month_balances(v_lm) where employee_id = e1;
  v_out := v_out || pg_temp.ln(b.accrued = 0 and b.advanced = 2000,
    'MW-DB-10', 'จ่ายแล้ว ค่าแรงเดือนที่แล้วของ e1 = 0 · เหลือแค่เบิกค้าง 2,000 (ซึ่งเดือนนี้เห็นเป็นยกมา)',
    format('%s / %s', b.accrued, b.advanced));

  -- วันเก่าที่ลงทีหลัง (ก่อนรอบที่จ่ายแล้ว) → บอกให้จ่ายเดือนนั้นก่อน ไม่ใช่ error กลาง ๆ
  execute 'reset role';
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_lm - 3, v_site, e1, 1);
  execute 'set local role authenticated';
  begin
    perform * from public.pay_employee_wage(e1, 0, null, v_cm + 40);
    v_out := v_out || pg_temp.ln(false, 'MW-DB-19', 'วันเก่าคร่อมรอบที่จ่ายแล้วต้องถูกปฏิเสธ', 'จ่ายได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%OLDER_DAY_UNPAID%', 'MW-DB-19', 'วันเก่าคร่อมรอบที่จ่ายแล้ว → OLDER_DAY_UNPAID', sqlerrm);
  end;
  execute 'reset role';
  delete from public.attendance where employee_id = e1 and work_date = v_lm - 3;
  execute 'set local role authenticated';

  -- e2: expected ต้องเท่ากับใบสรุป · เงินที่ออกก่อนของเดือนนี้ไม่ถูกคืน
  begin
    perform * from public.pay_employee_wage(e2, 0, 99, v_lme);
    v_out := v_out || pg_temp.ln(false, 'MW-DB-11', 'expected ผิดต้องถูกปฏิเสธ', 'จ่ายได้');
  exception when others then
    v_out := v_out || pg_temp.ln(sqlerrm like '%BALANCE_CHANGED%', 'MW-DB-11', 'expected ไม่ตรงยอดถึงสิ้นเดือน → BALANCE_CHANGED', sqlerrm);
  end;
  select * into l from public.pay_employee_wage(e2, 0, 2300, v_lme);
  v_out := v_out || pg_temp.ln(l.paid = 2300 and l.reimbursed = 300,
    'MW-DB-12', 'จ่ายถึงสิ้นเดือนที่แล้ว (e2) = ยอดใบสรุป 2,300 ทุกบาท', format('%s / %s', l.paid, l.reimbursed));
  select (select settled_run_id from public.transactions where id = t_lm) = l.run_id
     and (select settled_run_id from public.transactions where id = t_now) is null
     and (select sum(deducted_amount) from public.advances where employee_id = e2 and advance_date = v_today) = 0
    into v_bool;
  v_out := v_out || pg_temp.ln(v_bool, 'MW-DB-13', 'เงินที่ออกก่อน/ใบเบิกของเดือนนี้ไม่ถูกคืน/หักในรอบเดือนที่แล้ว', '');

  -- จ่ายทุกคนแบบมีวันตัด → ส่งต่อถึงรายคน
  select count(*) into v_int from public.pay_employees(
    jsonb_build_array(jsonb_build_object('employee_id', e3, 'bonus', 0, 'expected', 1000)), v_lme);
  select not public.attendance_paid(e3, v_today, v_site) into v_bool;
  v_out := v_out || pg_temp.ln(v_int = 1 and v_bool, 'MW-DB-14', 'จ่ายทุกคน + วันตัด: จ่าย e3 เฉพาะ 1,000 ของเดือนที่แล้ว', v_int::text);

  -- ไม่ส่งวันตัด = แบบเดิม (ทุกอย่างที่ค้าง) — client เวอร์ชันเก่าระหว่าง apply กับ deploy
  select * into l from public.pay_employee_wage(e3);
  v_out := v_out || pg_temp.ln(l.accrued = 500 and public.attendance_paid(e3, v_today, v_site),
    'MW-DB-15', 'ไม่ส่งวันตัด = จ่ายทุกอย่างที่ค้างถึงวันนี้ (เข้ากันได้กับของเดิม)', l.accrued::text);

  -- ════ สิทธิ์ ═══════════════════════════════════════════════════════
  execute 'reset role';
  select count(*) into v_int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('pay_employee_wage', 'pay_employees', 'bot_wage_list', 'bot_wage_detail');
  v_out := v_out || pg_temp.ln(v_int = 4, 'MW-DB-16', 'ไม่มีฟังก์ชันชื่อซ้ำตัวเก่าค้าง (drop ก่อน create)', v_int::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_int from public.payroll_month_balances(v_cm);
  select count(*) + v_int into v_int from public.payroll_open_months();
  v_out := v_out || pg_temp.ln(v_int = 0, 'MW-DB-17', 'หัวหน้าโครงการเรียกยอดรายเดือน/เดือนค้าง → ว่างเปล่า (ยอดค่าแรงเป็นความลับ)', v_int::text);

  execute 'reset role';
  select not has_function_privilege('anon', 'public.payroll_month_balances(date)', 'execute')
     and not has_function_privilege('anon', 'public.payroll_balances_through(date)', 'execute')
     and not has_function_privilege('anon', 'public.pay_employee_wage(uuid, numeric, numeric, date)', 'execute')
    into v_bool;
  v_out := v_out || pg_temp.ln(v_bool, 'MW-DB-18', 'anon เรียกฟังก์ชันใหม่ไม่ได้', '');

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
