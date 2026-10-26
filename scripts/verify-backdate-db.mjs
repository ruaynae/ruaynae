#!/usr/bin/env node
/**
 * verify-backdate-db.mjs — ปิดแถว BD-DB-* ใน docs/test-plan/R23-attendance-backdate.md
 *
 * 🔴 ไม่ทิ้งอะไรไว้ในฐานเลย — ทุกอย่างอยู่ใน `do` block เดียวที่จบด้วย `raise exception`
 * พร้อมรายงานผล · exception ทำให้ทั้งก้อน rollback (fixture · คำขอ · แจ้งเตือน · audit_log)
 * จึงรันบนฐานจริงได้โดยไม่มีโค้ดเก็บกวาด (§17 ข้อ 30)
 * 🔴 คำสั่งที่ "สำเร็จ" แทนที่จะโยน exception = แดงทันที (รายงานไม่ถูกส่งกลับ อาจมีของค้าง)
 *
 * สวมสิทธิ์ด้วย `set local role authenticated` + `request.jwt.claims` เพื่อทดสอบ RLS/trigger จริง
 *
 * ใช้: node scripts/verify-backdate-db.mjs
 */
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
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

// ── ตัวช่วยสร้าง SQL ────────────────────────────────────────────────
const asSup = `perform set_config('request.jwt.claims', json_build_object('sub', v_sup::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';`
const asOwner = `perform set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';`
const asSuper = `reset role;`

/** statement ต้องถูกปฏิเสธด้วยข้อความที่มี `like` */
const err = (id, label, stmt, like) => `
  begin
    ${stmt};
    v_fail := v_fail + 1; v_out := v_out || E'❌ ${id} ${label} — ไม่ถูกปฏิเสธ\\n';
  exception when others then
    if sqlerrm like '%${like}%' then v_pass := v_pass + 1; v_out := v_out || E'✅ ${id} ${label} → ${like}\\n';
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ ${id} ${label} ได้ error อื่น: %s\\n', sqlerrm); end if;
  end;`

/** เงื่อนไข boolean ต้องเป็นจริง */
const ok = (id, label, cond) => `
  if (${cond}) then v_pass := v_pass + 1; v_out := v_out || E'✅ ${id} ${label}\\n';
  else v_fail := v_fail + 1; v_out := v_out || E'❌ ${id} ${label}\\n'; end if;`

const BLOCK = `do $check$
declare
  v_out   text := E'\\n── R23-BD-DB บนฐานจริง ────────────────────────────\\n';
  v_pass  int := 0;
  v_fail  int := 0;
  v_owner uuid;
  v_sup   uuid;
  v_site  uuid;
  v_site2 uuid;
  v_emp   uuid;
  v_emp2  uuid;
  v_att   uuid;
  v_req   uuid;
  v_req2  uuid;
  v_req3  uuid;
  v_req4  uuid;
  v_n     int;
  v_st    text;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform pg_catalog.set_config('search_path', 'public', true);

  select id into v_owner from public.profiles where role = 'owner' and is_active limit 1;
  select id into v_sup   from public.profiles where role = 'site_supervisor' and is_active limit 1;
  if v_owner is null or v_sup is null then
    raise exception 'ต้องมีเจ้าของและหัวหน้าโครงการอย่างน้อยอย่างละหนึ่งคนในฐาน';
  end if;

  -- fixture (ถูก rollback ทิ้งทั้งหมด)
  insert into public.sites(name, status) values ('BD ตรวจชั่วคราว', 'active') returning id into v_site;
  insert into public.sites(name, status) values ('BD ตรวจชั่วคราว 2 (ไม่ได้ดูแล)', 'active') returning id into v_site2;
  insert into public.site_supervisors(site_id, profile_id, effective_from) values (v_site, v_sup, v_today - 30);
  insert into public.employees(full_name, job_title) values ('BD ตรวจชั่วคราว', 'กรรมกร') returning id into v_emp;
  insert into public.employees(full_name, job_title) values ('BD ตรวจชั่วคราว สอง', 'กรรมกร') returning id into v_emp2;
  insert into public.employee_wages(employee_id, wage_type, daily_rate) values (v_emp, 'daily', 500), (v_emp2, 'daily', 500);
  -- แถวย้อนหลังที่มีอยู่แล้ว (ลงโดยสคริปต์ = ไม่ใช่หัวหน้า)
  insert into public.attendance(work_date, site_id, employee_id, work_units)
    values (v_today - 3, v_site, v_emp, 1) returning id into v_att;

  -- ═══ ด่านที่ attendance (หัวหน้าโครงการ) ═══
  ${asSup}
  begin
    insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, v_emp2, 1);
    v_pass := v_pass + 1; v_out := v_out || E'✅ BD-DB-01 หัวหน้าลงชื่อ "วันนี้" ได้ตามปกติ\\n';
  exception when others then
    v_fail := v_fail + 1; v_out := v_out || format(E'❌ BD-DB-01 ลงวันนี้ไม่ได้: %s\\n', sqlerrm);
  end;
  ${err('BD-DB-02', 'หัวหน้าลงชื่อ "เมื่อวาน" เอง', `insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today - 1, v_site, v_emp2, 1)`, 'BACKDATE_NEEDS_APPROVAL')}
  ${err('BD-DB-03', 'หัวหน้าแก้แถวย้อนหลัง', `update public.attendance set note = 'แก้เอง' where id = v_att`, 'BACKDATE_NEEDS_APPROVAL')}
  ${err('BD-DB-04', 'หัวหน้าลบแถวย้อนหลัง', `delete from public.attendance where id = v_att`, 'BACKDATE_NEEDS_APPROVAL')}
  ${err('BD-DB-05', 'หัวหน้าแก้วันที่ของแถววันนี้ให้ถอยหลัง', `update public.attendance set work_date = v_today - 1 where site_id = v_site and employee_id = v_emp2 and work_date = v_today`, 'BACKDATE_NEEDS_APPROVAL')}
  ${asSuper}
  ${ok('BD-DB-05b', 'แถวย้อนหลังเดิมยังอยู่ครบ ไม่ถูกแก้/ลบ', `(select count(*) from public.attendance where id = v_att and note is null) = 1`)}

  ${asOwner}
  begin
    insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today - 8, v_site, v_emp, 1);
    v_pass := v_pass + 1; v_out := v_out || E'✅ BD-DB-06 เจ้าของลงชื่อย้อนหลังตรง ๆ ได้\\n';
  exception when others then
    v_fail := v_fail + 1; v_out := v_out || format(E'❌ BD-DB-06 เจ้าของลงย้อนหลังไม่ได้: %s\\n', sqlerrm);
  end;
  ${asSuper}

  -- ═══ ยื่นคำขอ ═══
  ${asSup}
  v_req := public.attendance_backdate_request(v_site, v_emp2, v_today - 1, 1, 'ลืมลงชื่อ');
  ${asSuper}
  select status into v_st from public.attendance_backdate_requests where id = v_req;
  ${ok('BD-DB-07', 'ยื่นคำขอ → pending · ยังไม่มีแถว attendance', `v_st = 'pending' and (select count(*) from public.attendance where employee_id = v_emp2 and work_date = v_today - 1) = 0`)}
  ${ok('BD-DB-07b', 'เจ้าของได้แจ้งเตือน backdate_pending', `(select count(*) from public.notifications where user_id = v_owner and kind = 'backdate_pending' and body like '%BD ตรวจชั่วคราว สอง%') >= 1`)}

  ${asSup}
  ${err('BD-DB-08', 'ยื่นคำขอของ "วันนี้"', `perform public.attendance_backdate_request(v_site, v_emp, v_today, 1, 'x')`, 'DATE_NOT_PAST')}
  ${err('BD-DB-09', 'ยื่นซ้ำ (คนเดียวกัน วันเดียวกัน)', `perform public.attendance_backdate_request(v_site, v_emp2, v_today - 1, 1, 'ซ้ำ')`, 'REQUEST_DUPLICATE')}
  ${err('BD-DB-10', 'ยื่นโดยไม่มีเหตุผล', `perform public.attendance_backdate_request(v_site, v_emp, v_today - 2, 1, '   ')`, 'REASON_REQUIRED')}
  ${err('BD-DB-11', 'ยื่นโครงการที่ไม่ได้ดูแล', `perform public.attendance_backdate_request(v_site2, v_emp, v_today - 2, 1, 'x')`, 'FORBIDDEN')}
  ${err('BD-DB-12', 'insert ลงตารางคำขอตรง ๆ', `insert into public.attendance_backdate_requests(site_id, employee_id, work_date, work_units, reason, requested_by) values (v_site, v_emp, v_today - 2, 1, 'x', v_sup)`, 'row-level security')}
  ${err('BD-DB-13', 'หัวหน้าอนุมัติคำขอเอง', `perform public.attendance_backdate_decide(v_req, true, null)`, 'FORBIDDEN')}
  ${asSuper}

  -- ═══ เจ้าของตัดสิน ═══
  ${asOwner}
  perform public.attendance_backdate_decide(v_req, true, null);
  ${asSuper}
  select status into v_st from public.attendance_backdate_requests where id = v_req;
  ${ok('BD-DB-14', 'อนุมัติ → มีแถว attendance จริง · คำขอเป็น approved · ผูก attendance_id', `v_st = 'approved' and (select count(*) from public.attendance a join public.attendance_backdate_requests r on r.attendance_id = a.id where r.id = v_req and a.employee_id = v_emp2 and a.work_date = v_today - 1 and a.site_id = v_site) = 1`)}
  ${ok('BD-DB-14b', 'หัวหน้าได้แจ้งเตือน backdate_approved', `(select count(*) from public.notifications where user_id = v_sup and kind = 'backdate_approved' and body like '%BD ตรวจชั่วคราว สอง%') >= 1`)}
  ${ok('BD-DB-14c', 'ค่าแรงวันนั้นเข้าต้นทุน (snapshot ฿500)', `(select coalesce(sum(w.amount),0) from public.attendance_wages w join public.attendance a on a.id = w.attendance_id where a.employee_id = v_emp2 and a.work_date = v_today - 1) = 500`)}
  ${asOwner}
  ${err('BD-DB-15', 'อนุมัติซ้ำ', `perform public.attendance_backdate_decide(v_req, true, null)`, 'REQUEST_DECIDED')}
  ${asSuper}

  ${asSup}
  v_req2 := public.attendance_backdate_request(v_site, v_emp, v_today - 5, 0.5, 'ครึ่งวัน');
  ${asOwner}
  ${err('BD-DB-16', 'ไม่อนุมัติโดยไม่ให้เหตุผล', `perform public.attendance_backdate_decide(v_req2, false, '')`, 'REASON_REQUIRED')}
  perform public.attendance_backdate_decide(v_req2, false, 'วันนั้นไม่มีงาน');
  ${asSuper}
  select status into v_st from public.attendance_backdate_requests where id = v_req2;
  ${ok('BD-DB-17', 'ไม่อนุมัติ → rejected · ไม่มีแถว attendance', `v_st = 'rejected' and (select count(*) from public.attendance where employee_id = v_emp and work_date = v_today - 5) = 0`)}
  ${ok('BD-DB-17b', 'หัวหน้าได้แจ้งเตือนพร้อมเหตุผลจริง', `(select count(*) from public.notifications where user_id = v_sup and kind = 'backdate_rejected' and body like '%วันนั้นไม่มีงาน%') >= 1`)}

  -- ═══ ยกเลิกคำขอของตัวเอง ═══
  ${asSup}
  v_req3 := public.attendance_backdate_request(v_site, v_emp, v_today - 6, 1, 'ลองยกเลิก');
  perform public.attendance_backdate_cancel(v_req3);
  ${asSuper}
  select status into v_st from public.attendance_backdate_requests where id = v_req3;
  ${ok('BD-DB-18', 'ยกเลิกคำขอของตัวเอง → cancelled', `v_st = 'cancelled'`)}
  ${asSup}
  ${err('BD-DB-18b', 'ยกเลิกซ้ำ', `perform public.attendance_backdate_cancel(v_req3)`, 'REQUEST_DECIDED')}
  begin
    perform public.attendance_backdate_request(v_site, v_emp, v_today - 6, 1, 'ยื่นใหม่หลังยกเลิก');
    v_pass := v_pass + 1; v_out := v_out || E'✅ BD-DB-18c ยื่นช่องเดิมใหม่ได้หลังยกเลิก (unique index เฉพาะ pending)\\n';
  exception when others then
    v_fail := v_fail + 1; v_out := v_out || format(E'❌ BD-DB-18c ยื่นใหม่ไม่ได้: %s\\n', sqlerrm);
  end;
  ${asSuper}

  -- ═══ guard เดิมยังทำงานตอนอนุมัติ ═══
  ${asSup}
  v_req4 := public.attendance_backdate_request(v_site, v_emp, v_today - 7, 1, 'ชนโครงการอื่น');
  ${asSuper}
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today - 7, v_site2, v_emp, 1);
  ${asOwner}
  ${err('BD-DB-19', 'อนุมัติแล้วเกินหนึ่งวันต่อคน', `perform public.attendance_backdate_decide(v_req4, true, null)`, 'WORK_UNITS_EXCEEDED')}
  ${asSuper}
  select status into v_st from public.attendance_backdate_requests where id = v_req4;
  ${ok('BD-DB-19b', 'อนุมัติไม่ผ่าน → คำขอยังเป็น pending (ไม่ถูกตีตราว่าอนุมัติ)', `v_st = 'pending'`)}

  -- ═══ ขอบเขตสิทธิ์ ═══
  execute 'set local role anon';
  ${err('BD-DB-20', 'anon เรียก RPC ยื่นคำขอ', `perform public.attendance_backdate_request(v_site, v_emp, v_today - 2, 1, 'x')`, 'permission denied')}
  ${asSuper}
  ${ok('BD-DB-21', 'ตารางคำขอเปิด RLS และมี audit trigger', `(select relrowsecurity from pg_class where oid = 'public.attendance_backdate_requests'::regclass) and exists (select 1 from pg_trigger where tgrelid = 'public.attendance_backdate_requests'::regclass and tgname = 'attendance_backdate_audit')`)}

  raise exception '%', v_out;
end $check$;`

console.log('\n── R23 · ลงชื่อย้อนหลังต้องอนุมัติ (ฐานข้อมูล) ────────────────')

const { rolledBack, message } = await run(BLOCK)
let pass = 0
let fail = 0
if (!rolledBack) {
  fail += 1
  console.log('  ❌ ไม่ได้ถูก rollback — ตรวจของค้างในฐานทันที')
} else {
  for (const line of message.split('\n')) {
    const t = line.trim()
    if (t.startsWith('✅')) { pass += 1; console.log(`  ${t}`) }
    else if (t.startsWith('❌')) { fail += 1; console.log(`  ${t}`) }
  }
  if (pass + fail === 0) {
    fail += 1
    console.log(`  ❌ ไม่ได้รายงานผล (SQL ผิดพลาดก่อนถึงบรรทัดตรวจ): ${message.slice(0, 400)}`)
  }
}
console.log(`\n  ${pass}/${pass + fail} ผ่าน · ไม่มีแถวไหนถูกเขียนค้างไว้`)
// §17 ข้อ 32: ห้าม process.exit() หลัง fetch บน Windows
process.exitCode = fail === 0 ? 0 : 1
