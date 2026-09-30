#!/usr/bin/env node
/**
 * verify-line-db.mjs — ปิดแถวฝั่งฐานข้อมูลของ docs/test-plan/R16-line-bot.md
 *
 * 🔴 **ไม่ทิ้งอะไรไว้ในฐานเลย** — ทุกก้อนเป็น `do` block ที่จบด้วย `raise exception`
 * พร้อมรายงานผล · exception ม้วนทุกอย่างกลับ (fixture · คีย์ใน Vault · บัญชี LINE ·
 * แจ้งเตือน · `audit_log`) จึงรันบนฐานจริงของลูกค้าได้ (§17 ข้อ 30)
 *
 * 🔴 ถ้าคำสั่ง **สำเร็จ** แทนที่จะโยน exception = รายงานไม่ถูกส่งกลับ · ถือว่าแดง
 *
 * สิทธิ์: รันเป็น superuser แล้วสวมสิทธิ์ด้วย `set local role authenticated|service_role`
 * + `request.jwt.claims` เพื่อทดสอบ RLS และ grant จริง
 *
 * ใช้: node scripts/verify-line-db.mjs
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
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  const text = await r.text()
  if (r.ok) return { rolledBack: false, message: text }
  let message = text
  try { message = JSON.parse(text)?.message ?? text } catch { /* ข้อความดิบก็พอ */ }
  return { rolledBack: true, message }
}

// ── ตัวช่วยสร้าง SQL ─────────────────────────────────────────────────────
const pass = (id, label) => `v_pass := v_pass + 1; v_out := v_out || E'✅ ${id} ${label}\\n';`
const chk = (id, cond, label, detail = `''`) => `
  if coalesce((${cond}), false) then ${pass(id, label)}
  else v_fail := v_fail + 1; v_out := v_out || format(E'❌ ${id} ${label} — %s\\n', ${detail}); end if;`
const expectErr = (id, stmt, like, label) => `
  begin
    ${stmt}
    v_fail := v_fail + 1; v_out := v_out || E'❌ ${id} ${label} — ไม่ถูกปฏิเสธ\\n';
  exception when others then
    if sqlerrm like '${like}' then ${pass(id, label)}
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ ${id} ${label} — error อื่น: %s\\n', sqlerrm); end if;
  end;`
const expectInvalid = (id, args, detail, label) => `
  begin
    perform public.set_line_keys(${args});
    v_fail := v_fail + 1; v_out := v_out || E'❌ ${id} ${label} — ไม่ถูกปฏิเสธ\\n';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlerrm = 'line_key_invalid' and v_detail = '${detail}' then ${pass(id, label)}
    else v_fail := v_fail + 1; v_out := v_out || format(E'❌ ${id} ${label} — ได้ %s / %s\\n', sqlerrm, v_detail); end if;
  end;`
const asAuth = (v) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${v}::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';`
const asSuper = (v) => `
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ${v}::text, 'role', 'authenticated')::text, true);`
const asService = `execute 'set local role service_role';`

const HEAD = (title) => `do $c$
declare
  v_out    text := E'\\n── ${title} ──────────────────────────────\\n';
  v_pass   int := 0;
  v_fail   int := 0;
  v_owner  uuid;
  v_sup    uuid;
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
  v_n      int;
  v_n2     int;
  v_txt    text;
  v_txt2   text;
  v_bad    text;
  v_detail text;
  v_j      jsonb;
  v_j2     jsonb;
  r        record;
begin
  perform pg_catalog.set_config('search_path', 'public', true);
  select id into v_owner from public.profiles where role = 'owner' and is_active limit 1;
  select id into v_sup   from public.profiles where role = 'site_supervisor' and is_active limit 1;
`
const TAIL = `
  raise exception '%', v_out;
end $c$;`

// ═══ ก้อน A · สิทธิ์ · คีย์ใน Vault ═════════════════════════════════════
const BLOCK_A = `${HEAD('R16-DB · สิทธิ์ · คีย์ใน Vault').replace('v_j2     jsonb;', 'v_j2     jsonb;\n  v_sec text;\n  v_tok text;\n  v_tok2 text;')}
  v_sec  := 'sec_' || repeat('x', 24) || 'ABCD';
  v_tok  := 'tok_' || repeat('y', 60) || 'EFGH';
  v_tok2 := 'tok_' || repeat('z', 60) || 'IJKL';

  -- R16-L0-18 · ทุกฟังก์ชันฝั่งบอทเรียกได้เฉพาะ service_role
  v_bad := ''; v_n := 0;
  for r in
    select p.oid::regprocedure::text as sig, p.proname as nm from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and (left(p.proname, 4) = 'bot_' or p.proname in ('_bot_as', '_line_key'))
  loop
    v_n := v_n + 1;
    if has_function_privilege('authenticated', r.sig, 'execute')
       or has_function_privilege('anon', r.sig, 'execute')
       or not has_function_privilege('service_role', r.sig, 'execute') then
      v_bad := v_bad || r.nm || ' ';
    end if;
  end loop;
  ${chk('R16-L0-18', `v_bad = '' and v_n >= 17`, 'ฟังก์ชัน bot_* · _bot_as · _line_key เรียกได้เฉพาะ service_role', `format('พบ %s ตัว · ผิด: %s', v_n, v_bad)`)}

  -- R16-DB-01 · ฟังก์ชันของหน้าตั้งค่า: anon เรียกไม่ได้ · authenticated เรียกได้ (แล้วเช็ค is_owner เอง)
  v_bad := '';
  for r in select unnest(array['set_line_keys(text,text)', 'line_key_status()', 'create_line_link_code()', 'unlink_line_account(uuid)']) as sig loop
    if has_function_privilege('anon', 'public.' || r.sig, 'execute')
       or not has_function_privilege('authenticated', 'public.' || r.sig, 'execute') then
      v_bad := v_bad || r.sig || ' ';
    end if;
  end loop;
  ${chk('R16-DB-01', `v_bad = ''`, 'set_line_keys · line_key_status · create_line_link_code · unlink_line_account: anon ไม่ได้ authenticated ได้', 'v_bad')}

  -- R16-DB-02 · ตาราง line_* ปิดจาก anon/authenticated (line_accounts อ่านได้อย่างเดียว) · RLS เปิดทุกตัว
  v_bad := '';
  for r in select unnest(array['line_link_codes', 'line_link_failures', 'line_events', 'line_sessions', 'line_outbox_test']) as t loop
    if has_table_privilege('authenticated', 'public.' || r.t, 'select,insert,update,delete')
       or has_table_privilege('anon', 'public.' || r.t, 'select,insert,update,delete') then
      v_bad := v_bad || r.t || ' ';
    end if;
  end loop;
  if has_table_privilege('anon', 'public.line_accounts', 'select')
     or has_table_privilege('authenticated', 'public.line_accounts', 'insert,update,delete')
     or not has_table_privilege('authenticated', 'public.line_accounts', 'select') then
    v_bad := v_bad || 'line_accounts ';
  end if;
  for r in select unnest(array['line_accounts', 'line_link_codes', 'line_link_failures', 'line_events', 'line_sessions', 'line_outbox_test']) as t loop
    if not exists (select 1 from pg_class c where c.oid = ('public.' || r.t)::regclass and c.relrowsecurity) then
      v_bad := v_bad || 'no-rls:' || r.t || ' ';
    end if;
  end loop;
  ${chk('R16-DB-02', `v_bad = ''`, 'ตาราง line_* ปิดจาก anon/authenticated · RLS เปิดครบหกตาราง', 'v_bad')}

  -- ── สวมสิทธิ์หัวหน้าโครงการ ────────────────────────────────────────────
  ${asAuth('v_sup')}
  ${expectErr('R16-DB-03', `perform public._line_key('line_channel_secret');`, '%permission denied%', 'หัวหน้าโครงการอ่านคีย์จริงผ่าน _line_key ไม่ได้')}
  ${expectErr('R16-DB-04', `perform public.set_line_keys('${'a'.repeat(30)}', '${'b'.repeat(50)}');`, '%FORBIDDEN%', 'หัวหน้าโครงการตั้งคีย์ไม่ได้ → FORBIDDEN')}
  ${expectErr('R16-DB-05', `perform public.line_key_status();`, '%FORBIDDEN%', 'หัวหน้าโครงการดูสถานะคีย์ไม่ได้ → FORBIDDEN')}
  ${expectErr('R16-L0-07', `perform public.create_line_link_code();`, '%FORBIDDEN%', 'หัวหน้าโครงการสร้างรหัสผูก LINE ไม่ได้ → FORBIDDEN')}
  ${expectErr('R16-DB-06', `perform public.unlink_line_account(gen_random_uuid());`, '%FORBIDDEN%', 'หัวหน้าโครงการยกเลิกการผูกของเจ้าของไม่ได้ → FORBIDDEN')}
  ${expectErr('R16-DB-07', `perform count(*) from public.line_link_codes;`, '%permission denied%', 'authenticated อ่านตารางรหัสผูกตรง ๆ ไม่ได้')}

  -- ── สวมสิทธิ์เจ้าของ ─────────────────────────────────────────────────
  ${asSuper('v_owner')}
  ${asAuth('v_owner')}
  ${expectInvalid('R16-DB-08', `'short', null`, 'secret', 'secret สั้นเกินไปถูกปฏิเสธ (line_key_invalid · secret)')}
  ${expectInvalid('R16-DB-09', `'${'a'.repeat(12)} ${'b'.repeat(12)}', null`, 'secret', 'secret ที่มีช่องว่างถูกปฏิเสธ')}
  ${expectInvalid('R16-DB-10', `null, '${'t'.repeat(39)}'`, 'token', 'token สั้นเกินไปถูกปฏิเสธ (line_key_invalid · token)')}

  select count(*) into v_n from public.audit_log where table_name = 'line_keys';
  perform public.set_line_keys(v_sec, v_tok);
  v_j := public.line_key_status();
  ${chk('R16-DB-11', `v_j->'channel_secret'->>'last4' = 'ABCD' and v_j->'access_token'->>'last4' = 'EFGH'
       and (v_j->'channel_secret'->>'set')::boolean and (v_j->'access_token'->>'set')::boolean
       and position('xxxx' in v_j::text) = 0 and position('yyyy' in v_j::text) = 0`,
    'ตั้งคีย์แล้วสถานะโชว์แค่ 4 ตัวท้าย · ไม่มีค่าเต็มในคำตอบ', 'v_j::text')}

  reset role;
  select count(*) into v_n2 from public.audit_log
   where table_name = 'line_keys' and actor = v_owner and at = now()  -- เฉพาะแถวในทรานแซกชันนี้ · เจ้าของตั้งคีย์จริงไปแล้ว
     and after->'changed' = '["secret","token"]'::jsonb
     and position('xxxx' in after::text) = 0 and position('yyyy' in after::text) = 0;
  ${chk('R16-DB-12', `v_n2 = 1`, 'audit_log บันทึกว่าใครเปลี่ยนคีย์ (ชื่อช่องเท่านั้น · ไม่มีค่าคีย์)', 'v_n2::text')}

  -- ช่องว่าง = คงค่าเดิม
  ${asAuth('v_owner')}
  perform public.set_line_keys('', v_tok2);
  v_j := public.line_key_status();
  ${chk('R16-DB-13', `v_j->'channel_secret'->>'last4' = 'ABCD' and v_j->'access_token'->>'last4' = 'IJKL'`,
    'เว้น secret ว่าง = คงเดิม · เปลี่ยน token อย่างเดียวได้', 'v_j::text')}
  select count(*) into v_n2 from public.audit_log where table_name = 'line_keys';
  perform public.set_line_keys(null, '   ');
  select count(*) into v_n from public.audit_log where table_name = 'line_keys';
  ${chk('R16-DB-14', `v_n = v_n2`, 'ส่งว่างทั้งสองช่อง = ไม่เปลี่ยนอะไร · ไม่มีแถว audit เกิน', `format('%s → %s', v_n2, v_n)`)}

  -- ── เซิร์ฟเวอร์ (service_role) อ่านคีย์จริงได้ ──────────────────────────
  reset role;
  ${asService}
  v_txt  := public._line_key('line_channel_secret');
  v_txt2 := public._line_key('line_channel_access_token');
  ${chk('R16-DB-15', `v_txt = v_sec and v_txt2 = v_tok2`, 'service_role อ่านคีย์จริงจาก Vault ได้ตรงกับที่ตั้ง (token ล่าสุด)', `'ไม่ตรง'`)}
  ${expectErr('R16-DB-16', `perform public._line_key('bogus');`, '%line_key_unknown%', '_line_key ชื่อแปลกถูกปฏิเสธ')}
  reset role;
${TAIL}`

// ═══ ก้อน B · ผูกบัญชี · เซสชัน · event · โครงสร้าง ══════════════════════
const BLOCK_B = `${HEAD('R16-L0 · ผูกบัญชี · เซสชัน · event').replace('v_j2     jsonb;', `v_j2     jsonb;
  v_line   text := 'U' || md5('r16-main');
  v_line2  text := 'U' || md5('r16-second');
  v_line3  text := 'U' || md5('r16-sup');
  v_code   text;
  v_code2  text;
  v_code3  text;
  v_acc    uuid;
  v_name   text;`)}
  select full_name into v_name from public.profiles where id = v_owner;
  delete from public.line_accounts where profile_id in (v_owner, v_sup);
  delete from public.line_sessions where line_user_id in (v_line, v_line2, v_line3);

  -- R16-L0-05 · รหัส 6 หลัก · ออกใหม่แทนอันเก่า · เก็บเป็น hash
  ${asAuth('v_owner')}
  v_code  := public.create_line_link_code();
  v_code2 := public.create_line_link_code();
  reset role;
  select count(*) into v_n from public.line_link_codes where profile_id = v_owner and used_at is null;
  ${chk('R16-L0-05', `v_code ~ '^[0-9]{6}$' and v_code2 ~ '^[0-9]{6}$' and v_n = 1
       and exists (select 1 from public.line_link_codes where code_hash = extensions.digest(v_code2, 'sha256'))`,
    'รหัสผูก 6 หลัก · ขอใหม่แทนอันเก่า (เหลือ 1 ใบ) · เก็บเป็น sha256', `format('%s / %s / %s', v_code, v_code2, v_n)`)}

  -- รหัสของคนที่ไม่ใช่เจ้าของ + รหัสหมดอายุ (ใส่ตรง ๆ ตอนเป็น superuser)
  insert into public.line_link_codes(code_hash, profile_id, expires_at) values
    (extensions.digest('111111', 'sha256'), v_sup,   now() + interval '10 minutes'),
    (extensions.digest('333333', 'sha256'), v_owner, now() - interval '1 minute');

  ${asService}
  -- ความพยายามที่ผิด 5 ครั้ง: รหัสเก่า · รหัสหัวหน้าโครงการ · รหัสหมดอายุ · เดา 2 ครั้ง
  v_j := public.bot_link(v_line, v_code, 'ทดสอบ');
  ${chk('R16-DB-17', `v_code = v_code2 or (v_j->>'ok')::boolean = false`, 'รหัสเก่าที่ถูกแทนที่แล้วใช้ไม่ได้', 'v_j::text')}
  v_j := public.bot_link(v_line, '111111', 'ทดสอบ');
  ${chk('R16-L0-07', `(v_j->>'ok')::boolean = false`, 'รหัสของบัญชีที่ไม่ใช่เจ้าของ (หัวหน้าโครงการ) ผูกไม่ได้', 'v_j::text')}
  v_j := public.bot_link(v_line, '333333', 'ทดสอบ');
  ${chk('R16-DB-18', `(v_j->>'ok')::boolean = false`, 'รหัสหมดอายุผูกไม่ได้', 'v_j::text')}
  v_j := public.bot_link(v_line, '000000', 'ทดสอบ');
  v_j := public.bot_link(v_line, '000000', 'ทดสอบ');
  v_j := public.bot_link(v_line, v_code2, 'ทดสอบ');
  ${chk('R16-L0-08', `(v_j->>'ok')::boolean = false and (v_j->>'locked')::boolean`,
    'ผิด 5 ครั้งใน 1 ชม. → ล็อก แม้ครั้งที่หกจะเป็นรหัสที่ถูก', 'v_j::text')}
  reset role;
  select count(*) into v_n from public.line_accounts where profile_id = v_owner;
  ${chk('R16-DB-19', `v_n = 0`, 'ตอนถูกล็อก ไม่มีบัญชีถูกผูก', 'v_n::text')}

  delete from public.line_link_failures where line_user_id = v_line;
  ${asService}
  v_j := public.bot_link(v_line, v_code2, 'ทดสอบ');
  reset role;
  ${chk('R16-L0-06', `(v_j->>'ok')::boolean and v_j->>'name' = v_name`, 'รหัสถูก → ผูกสำเร็จ · ตอบชื่อเจ้าของ', 'v_j::text')}
  select count(*) into v_n from public.line_accounts where profile_id = v_owner and line_user_id = v_line and display_name = 'ทดสอบ';
  select count(*) into v_n2 from public.line_link_failures where line_user_id = v_line;
  ${chk('R16-DB-20', `v_n = 1 and v_n2 = 0`, 'มีแถว line_accounts 1 แถว · ล้างประวัติผิดพลาดแล้ว', `format('%s / %s', v_n, v_n2)`)}
  select count(*) into v_n from public.audit_log
   where table_name = 'line_accounts' and action = 'INSERT' and after->>'profile_id' = v_owner::text and at >= now() - interval '5 minutes';
  ${chk('R16-DB-21', `v_n >= 1`, 'ผูกบัญชีมีร่องรอยใน audit_log (trigger line_accounts_audit)', 'v_n::text')}

  ${asService}
  v_j := public.bot_link(v_line2, v_code2, 'อีกเครื่อง');
  reset role;
  ${chk('R16-DB-22', `(v_j->>'ok')::boolean = false`, 'รหัสใช้ได้ครั้งเดียว · ใช้ซ้ำจาก LINE อื่นไม่ได้', 'v_j::text')}

  ${asService}
  v_j  := public.bot_whoami(v_line);
  v_j2 := public.bot_whoami(v_line2);
  reset role;
  ${chk('R16-DB-23', `(v_j->>'linked')::boolean and v_j->>'name' = v_name and not (v_j2->>'linked')::boolean`,
    'bot_whoami: ผูกแล้ว → ชื่อเจ้าของ · LINE ที่ยังไม่ผูก → linked=false', 'v_j::text || v_j2::text')}

  -- R16-DB-24 · RLS ของ line_accounts: เจ้าของเห็น · หัวหน้าโครงการไม่เห็น
  ${asAuth('v_owner')}
  select count(*) into v_n from public.line_accounts;
  reset role;
  ${asAuth('v_sup')}
  select count(*) into v_n2 from public.line_accounts;
  reset role;
  ${chk('R16-DB-24', `v_n >= 1 and v_n2 = 0`, 'line_accounts: เจ้าของอ่านได้ · หัวหน้าโครงการเห็น 0 แถว', `format('%s / %s', v_n, v_n2)`)}

  -- R16-L0-07b · บัญชี LINE ที่ผูกกับหัวหน้าโครงการ (ใส่ตรง ๆ) ก็ใช้บอทไม่ได้
  insert into public.line_accounts(line_user_id, profile_id) values (v_line3, v_sup);
  ${asService}
  v_j := public.bot_whoami(v_line3);
  ${chk('R16-L0-07b', `not (v_j->>'linked')::boolean`, 'บัญชี LINE ของหัวหน้าโครงการ → ไม่นับว่าผูก', 'v_j::text')}
  ${expectErr('R16-L0-07c', `perform public.bot_queue(v_line3);`, '%line_not_owner%', 'บัญชี LINE ของหัวหน้าโครงการเรียก bot_queue → line_not_owner')}
  ${expectErr('R16-DB-25', `perform public.bot_queue('U' || md5('nobody'));`, '%line_not_owner%', 'LINE ที่ไม่เคยผูกเรียก bot_queue → line_not_owner')}
  reset role;

  -- R16-DB-44 · เจ้าของผูก LINE ได้หลายบัญชี (คำขอเจ้าของ 30 ก.ย. 2569)
  ${asAuth('v_owner')}
  v_code3 := public.create_line_link_code();
  reset role;
  ${asService}
  v_j := public.bot_link(v_line2, v_code3, 'เครื่องที่สอง');
  v_j2 := public.bot_whoami(v_line);
  reset role;
  select count(*) into v_n from public.line_accounts where profile_id = v_owner and line_user_id in (v_line, v_line2);
  ${chk('R16-DB-44', `(v_j->>'ok')::boolean and (v_j2->>'linked')::boolean and v_n = 2`,
    'ผูก LINE บัญชีที่สองได้ · บัญชีแรกยังผูกอยู่ (ไม่ถูกแทนที่)', `format('%s %s %s', v_j, v_j2, v_n)`)}

  -- R16-L0-11 · เจ้าของกดยกเลิกการผูกทีละบัญชี
  select id into v_acc from public.line_accounts where line_user_id = v_line;
  ${asAuth('v_owner')}
  perform public.unlink_line_account(v_acc);
  reset role;
  select count(*) into v_n from public.line_accounts where line_user_id = v_line;
  ${asService}
  v_j := public.bot_whoami(v_line);
  v_j2 := public.bot_whoami(v_line2);
  reset role;
  ${chk('R16-L0-11', `v_n = 0 and not (v_j->>'linked')::boolean and (v_j2->>'linked')::boolean`,
    'เลิกผูกบัญชีหนึ่ง → บัญชีนั้นหาย · บัญชีอื่นของเจ้าของยังใช้ได้', `format('%s %s %s', v_n, v_j, v_j2)`)}
  ${asAuth('v_owner')}
  ${expectErr('R16-DB-45', `perform public.unlink_line_account(v_acc);`, '%NOT_FOUND%', 'เลิกผูกบัญชีที่ไม่มีแล้ว → NOT_FOUND (ไม่ใช่สำเร็จเงียบ ๆ)')}
  reset role;
  delete from public.line_accounts where line_user_id = v_line2;

  -- R16-L0-11b · เจ้าของถูกปิดใช้งาน → บอทหยุดรับ
  insert into public.line_accounts(line_user_id, profile_id) values (v_line, v_owner);
  begin
    ${asSuper('v_owner')}
    update public.profiles set is_active = false where id = v_owner;
    ${asService}
    v_j := public.bot_whoami(v_line);
    ${chk('R16-L0-11b', `not (v_j->>'linked')::boolean`, 'เจ้าของถูกปิดใช้งาน → bot_whoami linked=false', 'v_j::text')}
    ${expectErr('R16-L0-11c', `perform public.bot_queue(v_line);`, '%line_not_owner%', 'เจ้าของถูกปิดใช้งาน → bot_queue → line_not_owner')}
    reset role;
    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = true where id = v_owner;
  exception when others then
    reset role;
    v_fail := v_fail + 1; v_out := v_out || format(E'❌ R16-L0-11b ปิดใช้งานเจ้าของในฟิกซ์เจอร์ไม่ได้: %s\\n', sqlerrm);
  end;

  -- R16-L0-03 · event ซ้ำ
  ${asService}
  ${chk('R16-L0-03', `public.bot_event_seen('r16-evt-1') = false and public.bot_event_seen('r16-evt-1') = true
       and public.bot_event_seen('') = false and public.bot_event_seen(null) = false`,
    'bot_event_seen: ครั้งแรก false · ซ้ำ true · ว่าง/null = false (ไม่ข้าม)', `'ผลไม่ตรง'`)}

  -- R16-L0-12/14 · เซสชัน
  v_j := public.bot_session_get(v_line);
  ${chk('R16-DB-26', `v_j is null`, 'ยังไม่มีเซสชัน → bot_session_get = null', 'v_j::text')}
  perform public.bot_session_set(v_line, 'exp_amount', '{"a":1}'::jsonb);
  v_j := public.bot_session_get(v_line);
  ${chk('R16-DB-27', `v_j->>'state' = 'exp_amount' and v_j->'payload'->>'a' = '1'`, 'ตั้งเซสชัน → อ่านกลับได้ตรง', 'v_j::text')}
  perform public.bot_session_set(v_line, 'exp_amount', '{"a":2}'::jsonb);
  v_j := public.bot_session_get(v_line);
  ${chk('R16-L0-12', `v_j->'payload'->>'a' = '2'`, 'ตั้งซ้ำ = ทับของเดิม (เมนูใหม่รีเซ็ตสถานะ)', 'v_j::text')}
  v_j := public.bot_session_append(v_line, 'exp_cat', 'slips', '{"k":1}'::jsonb, 2);
  ${chk('R16-DB-28', `v_j is null`, 'append เมื่อสถานะไม่ตรง → null (ไม่แตะเซสชัน)', 'v_j::text')}
  perform public.bot_session_set(v_line, 'exp_amount', '{}'::jsonb);
  v_j  := public.bot_session_append(v_line, 'exp_amount', 'slips', '{"k":1}'::jsonb, 2);
  v_j2 := public.bot_session_append(v_line, 'exp_amount', 'slips', '{"k":2}'::jsonb, 2);
  ${chk('R16-DB-29', `jsonb_array_length(v_j->'items') = 1 and jsonb_array_length(v_j2->'items') = 2 and not (v_j2->>'full')::boolean`,
    'append ต่อ array ทีละรายการ', 'v_j::text || v_j2::text')}
  v_j := public.bot_session_append(v_line, 'exp_amount', 'slips', '{"k":3}'::jsonb, 2);
  ${chk('R16-DB-30', `(v_j->>'full')::boolean and jsonb_array_length(v_j->'items') = 2`, 'เต็มเพดาน → full=true · ไม่ต่อเกิน', 'v_j::text')}

  reset role;
  update public.line_sessions set expires_at = now() - interval '1 second' where line_user_id = v_line;
  ${asService}
  v_j := public.bot_session_get(v_line);
  reset role;
  select count(*) into v_n from public.line_sessions where line_user_id = v_line;
  ${chk('R16-L0-14', `v_j is null and v_n = 0`, 'เซสชันหมดอายุ → อ่านได้ null และแถวถูกลบ', 'v_j::text')}

  ${asService}
  perform public.bot_session_set(v_line, 'exp_amount', '{}'::jsonb, 1);
  reset role;
  select count(*) into v_n from public.line_sessions where line_user_id = v_line and expires_at >= now() + interval '29 seconds';
  ${asService}
  perform public.bot_session_set(v_line, null);
  reset role;
  select count(*) into v_n2 from public.line_sessions where line_user_id = v_line;
  ${chk('R16-L0-13', `v_n2 = 0`, 'ตั้งสถานะ null (ยกเลิก) → เซสชันถูกล้าง', 'v_n2::text')}
  ${chk('R16-DB-31', `v_n = 1`, 'TTL ต่ำสุด 30 วินาที (ส่ง 1 → ได้ ≥ 29 วิ)', 'v_n::text')}

  -- R16-L4-05 · รูปหลายรูปพร้อมกัน — bot_session_photo
  ${asService}
  v_j := public.bot_session_photo(v_line, '{"k":"a"}'::jsonb, 2);
  ${chk('R16-DB-32', `(v_j->>'started')::boolean and (v_j->>'count')::int = 1 and v_j->>'state' = 'exp_amount'`,
    'รูปแรกตอนยังไม่มีเซสชัน → เริ่มเซสชัน exp_amount นับ 1', 'v_j::text')}
  v_j := public.bot_session_photo(v_line, '{"k":"b"}'::jsonb, 2);
  ${chk('R16-DB-33', `not (v_j->>'started')::boolean and (v_j->>'count')::int = 2 and not (v_j->>'full')::boolean`,
    'รูปที่สอง → ต่อเข้าเซสชันเดิม นับ 2 (ไม่สร้างทับ)', 'v_j::text')}
  v_j := public.bot_session_photo(v_line, '{"k":"c"}'::jsonb, 2);
  ${chk('R16-DB-34', `(v_j->>'full')::boolean and (v_j->>'count')::int = 2`, 'รูปที่สามเกินเพดาน → full=true ไม่ต่อ', 'v_j::text')}
  perform public.bot_session_set(v_line, 'allow_pick', '{"x":1}'::jsonb);
  v_j := public.bot_session_photo(v_line, '{"k":"d"}'::jsonb, 2);
  ${chk('R16-DB-35', `(v_j->>'started')::boolean and v_j->>'state' = 'exp_amount'`,
    'ส่งรูปตอนอยู่กลางเมนูอื่น → เริ่มเซสชันคีย์รายจ่ายใหม่', 'v_j::text')}
  reset role;

  -- โครงสร้าง
  select count(*) into v_n from cron.job where jobname = 'line-events-clean' and active;
  ${chk('R16-DB-36', `v_n = 1`, 'pg_cron งาน line-events-clean ตั้งอยู่และเปิดใช้งาน', 'v_n::text')}
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and (table_name, column_name) in
     (('notifications', 'line_pushed_at'), ('transactions', 'via_line'), ('audit_log', 'via_line'));
  select count(*) into v_n2 from pg_indexes where schemaname = 'public' and indexname in ('notifications_line_pending_idx', 'audit_log_via_line_idx');
  ${chk('R16-DB-37', `v_n = 3 and v_n2 = 2`, 'คอลัมน์ line_pushed_at · via_line (สองตาราง) และ index ครบ', `format('%s / %s', v_n, v_n2)`)}
${TAIL}`

// ═══ ก้อน C · พฤติกรรมของบอท (เมนู 1–4) ═════════════════════════════════
const BLOCK_C = `${HEAD('R16-L1..L4 · พฤติกรรมของบอท').replace('v_j2     jsonb;', `v_j2     jsonb;
  v_line   text := 'U' || md5('r16-main');
  v_site   uuid;
  v_cat    uuid;
  v_preset uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_e4 uuid;
  v_a1 uuid; v_a2 uuid;
  v_t1 uuid; v_t2 uuid; v_txn uuid;
  v_att uuid;
  v_ref uuid := gen_random_uuid();
  v_bool boolean;
  v_num numeric;`)}
  -- fixture (จะถูก rollback)
  delete from public.line_accounts where profile_id = v_owner;
  insert into public.line_accounts(line_user_id, profile_id) values (v_line, v_owner);
  insert into public.sites(name, status) values ('R16 ตรวจชั่วคราว', 'active') returning id into v_site;
  insert into public.site_supervisors(site_id, profile_id, effective_from) values (v_site, v_sup, v_today - 30);
  insert into public.employees(full_name, job_title) values ('R16 คน1', 'ช่าง') returning id into v_e1;
  insert into public.employees(full_name, job_title) values ('R16 คน2', 'ช่าง') returning id into v_e2;
  insert into public.employees(full_name, job_title) values ('R16 คน3', 'ช่าง') returning id into v_e3;
  insert into public.employees(full_name, job_title) values ('R16 คน4', 'ช่าง') returning id into v_e4;
  insert into public.employee_wages(employee_id, wage_type, daily_rate)
    select id, 'daily', 500 from public.employees where id in (v_e1, v_e2, v_e3, v_e4);
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, v_e1, 1) returning id into v_att;
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, v_e2, 0.5);
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, v_e3, 1);
  insert into public.wage_adjustment_presets(name, kind, amount) values ('R16 เบี้ยเลี้ยงตจว', 'add', 300) returning id into v_preset;
  select id into v_cat from public.categories where kind = 'expense' and is_active order by sort_order, name limit 1;
  if v_cat is null then
    insert into public.categories(name, kind) values ('R16 หมวดตรวจ', 'expense') returning id into v_cat;
  end if;

  -- ── หัวหน้าโครงการยื่นคำขอ 2 ใบเบิก + 2 รายจ่าย ─────────────────────────
  ${asAuth('v_sup')}
  insert into public.advances(employee_id, amount, advance_date, note) values (v_e1, 400, v_today, 'R16 เบิก 1') returning id into v_a1;
  insert into public.advances(employee_id, amount, advance_date, note) values (v_e2, 250, v_today, 'R16 เบิก 2') returning id into v_a2;
  insert into public.transactions(kind, site_id, category_id, amount, txn_date, pay_method)
    values ('expense', v_site, v_cat, 111, v_today, 'cash') returning id into v_t1;
  insert into public.transactions(kind, site_id, category_id, amount, txn_date, pay_method)
    values ('expense', v_site, v_cat, 222, v_today, 'cash') returning id into v_t2;
  reset role;

  -- ── เมนู 2 · คนเข้างาน ───────────────────────────────────────────────
  ${asService}
  v_j := public.bot_attendance_today(v_line, v_today);
  reset role;
  select jsonb_array_length(x->'people') into v_n from jsonb_array_elements(v_j->'sites') x where x->>'site_id' = v_site::text;
  select bool_and((select array_agg(k order by k) from jsonb_object_keys(p) k) = array['job', 'name', 'units'])
    into v_bool
    from jsonb_array_elements(v_j->'sites') x, jsonb_array_elements(x->'people') p;
  ${chk('R16-L1-02', `v_n = 3 and v_bool and (v_j->>'total_people')::int >= 3`,
    'คนเข้างานรายโครงการ: 3 คนของโครงการทดสอบ · แต่ละคนมีแค่ชื่อ/ตำแหน่ง/แรง — ไม่มียอดเงินหรือเรต', `format('%s %s %s', v_n, v_bool, v_j->>'total_people')`)}
  ${asService}
  v_j := public.bot_attendance_today(v_line, v_today + 400);
  reset role;
  ${chk('R16-L1-04', `jsonb_array_length(v_j->'sites') = 0 and (v_j->>'total_people')::int = 0`, 'วันที่ไม่มีใครลงชื่อ → sites ว่าง · total 0', 'v_j::text')}

  -- ── เมนู 3 · คิวรออนุมัติ ────────────────────────────────────────────
  ${asService}
  v_j := public.bot_queue(v_line);
  reset role;
  select count(*) into v_n from public.advances where status = 'pending';
  select count(*) into v_n2 from public.transactions where status = 'pending';
  ${chk('R16-L1-05', `(v_j->>'advance_count')::int = v_n and (v_j->>'expense_count')::int = v_n2
       and (v_j->>'advance_count')::int >= 2 and (v_j->>'expense_count')::int >= 2
       and jsonb_array_length(v_j->'advances') <= 10 and jsonb_array_length(v_j->'expenses') <= 10`,
    'bot_queue: จำนวนรวมตรงกับตารางจริง (ที่เมนูเว็บใช้) · แสดงไม่เกิน 10 ใบต่อชนิด', `format('%s/%s vs %s/%s', v_j->>'advance_count', v_j->>'expense_count', v_n, v_n2)`)}

  -- ── อนุมัติ / ตีกลับ ─────────────────────────────────────────────────
  ${asService}
  v_j := public.bot_approve(v_line, 'advance', v_a1, 'approve');
  reset role;
  select (status::text = 'approved' and approved_by = v_owner) into v_bool from public.advances where id = v_a1;
  ${chk('R16-L2-01', `(v_j->>'ok')::boolean and v_bool`, 'อนุมัติใบเบิก → approved · approved_by = เจ้าของ', 'v_j::text')}

  ${asService}
  v_j := public.bot_approve(v_line, 'advance', v_a1, 'approve');
  reset role;
  ${chk('R16-L2-03', `not (v_j->>'ok')::boolean and v_j->>'code' = 'ALREADY_APPROVED' and v_j->>'label' is not null`,
    'อนุมัติซ้ำ → ALREADY_APPROVED + ป้ายชื่อรายการ (ไม่ทำซ้ำ)', 'v_j::text')}

  ${asService}
  v_j := public.bot_approve(v_line, 'expense', v_t1, 'approve');
  reset role;
  select status::text into v_txt from public.transactions where id = v_t1;
  ${chk('R16-L2-02', `(v_j->>'ok')::boolean and v_txt = 'approved'`, 'อนุมัติรายจ่ายของหัวหน้าโครงการ → approved', 'v_j::text || v_txt')}

  ${asService}
  v_j  := public.bot_approve(v_line, 'expense', v_t2, 'reject');
  v_j2 := public.bot_approve(v_line, 'expense', v_t2, 'reject', '   ');
  reset role;
  select status::text into v_txt from public.transactions where id = v_t2;
  ${chk('R16-L2-04a', `v_j->>'code' = 'REASON_REQUIRED' and v_j2->>'code' = 'REASON_REQUIRED' and v_txt = 'pending'`,
    'ตีกลับโดยไม่มีเหตุผล (ว่าง/ช่องว่าง) → REASON_REQUIRED · รายการยัง pending', 'v_j::text || v_txt')}
  ${asService}
  v_j := public.bot_approve(v_line, 'expense', v_t2, 'reject', 'บิลไม่ชัด');
  v_j2 := public.bot_approve(v_line, 'advance', v_a2, 'reject', 'ยอดสูงเกิน');
  reset role;
  select (status::text = 'rejected' and rejected_reason = 'บิลไม่ชัด') into v_bool from public.transactions where id = v_t2;
  select (status::text = 'rejected' and rejected_reason = 'ยอดสูงเกิน') into v_bool from public.advances where id = v_a2 and v_bool is not distinct from v_bool;
  ${chk('R16-L2-04b', `(v_j->>'ok')::boolean and (v_j2->>'ok')::boolean and v_bool`,
    'ตีกลับพร้อมเหตุผล → rejected + เหตุผลถูกเก็บ (รายจ่ายและใบเบิก)', 'v_j::text || v_j2::text')}

  ${asService}
  v_j := public.bot_approve(v_line, 'advance', gen_random_uuid(), 'approve');
  reset role;
  ${chk('R16-DB-38', `v_j->>'code' = 'NOT_FOUND'`, 'id ที่ไม่มีอยู่ → NOT_FOUND', 'v_j::text')}
  ${asService}
  ${expectErr('R16-DB-39', `perform public.bot_approve(v_line, 'advance', v_a1, 'delete');`, '%BAD_REQUEST%', 'action แปลก → BAD_REQUEST')}
  reset role;

  select count(*) into v_n from public.audit_log
   where table_name = 'advances' and row_id::text = v_a1::text and action = 'UPDATE' and via_line;
  select count(*) into v_n2 from public.audit_log
   where table_name = 'advances' and row_id::text = v_a1::text and action = 'INSERT' and not via_line;
  ${chk('R16-L0-17a', `v_n >= 1 and v_n2 = 1`, 'audit_log: การอนุมัติผ่านบอทติด via_line=true · การยื่นคำขอเดิมของหัวหน้าไม่ติด', `format('%s / %s', v_n, v_n2)`)}
  select count(*) into v_n from public.notifications where user_id = v_sup and created_at >= now();
  ${chk('R16-L2-01b', `v_n >= 2`, 'หัวหน้าโครงการได้แจ้งเตือนกลับตามปกติ (อนุมัติ/ตีกลับผ่านบอทยิง trigger เดิม)', 'v_n::text')}

  -- ── เมนู 1 · คีย์รายจ่าย ─────────────────────────────────────────────
  ${asService}
  v_j := public.bot_create_expense(v_line, v_cat, 1234.50, v_today, v_site, 'cash', '  ตรวจ R16  ', v_ref);
  reset role;
  v_txn := (v_j->>'transaction_id')::uuid;
  select (status::text = 'approved' and via_line and created_by = v_owner and amount = 1234.50 and note = 'ตรวจ R16' and site_id = v_site and kind::text = 'expense')
    into v_bool from public.transactions where id = v_txn;
  ${chk('R16-L4-03a', `(v_j->>'ok')::boolean and not (v_j->>'duplicate')::boolean and v_bool`,
    'คีย์รายจ่ายผ่านบอท → approved · via_line · เจ้าของเป็น created_by · ตัดช่องว่างท้ายหมายเหตุ', 'v_j::text')}

  ${asService}
  v_j := public.bot_create_expense(v_line, v_cat, 1234.50, v_today, v_site, 'cash', 'ตรวจ R16', v_ref);
  reset role;
  select count(*) into v_n from public.transactions where client_ref = v_ref;
  ${chk('R16-L4-03b', `(v_j->>'duplicate')::boolean and (v_j->>'transaction_id')::uuid = v_txn and v_n = 1`,
    'ส่งซ้ำด้วย client_ref เดิม → duplicate · ยังมีแถวเดียว', `format('%s %s', v_j, v_n)`)}

  select count(*) into v_n from public.audit_log where table_name = 'transactions' and row_id::text = v_txn::text and action = 'INSERT' and via_line;
  ${chk('R16-L0-17b', `v_n = 1`, 'แถวรายจ่ายที่คีย์ผ่านบอท: audit_log INSERT ติด via_line', 'v_n::text')}

  -- ป้ายที่มาแก้ทับไม่ได้ (เจ้าของแก้ยอดเองได้ แต่ป้ายต้องอยู่)
  ${asSuper('v_owner')}
  ${asAuth('v_owner')}
  update public.transactions set via_line = false, amount = 1300 where id = v_txn;
  reset role;
  select (via_line and amount = 1300) into v_bool from public.transactions where id = v_txn;
  ${chk('R16-L0-17c', `v_bool`, 'เจ้าของแก้ยอดได้ แต่ป้าย via_line ถูกดันกลับ (keep_via_line) — แก้ทับไม่ได้', 'v_bool::text')}

  ${asService}
  ${expectErr('R16-L4-03c', `perform public.bot_create_expense(v_line, v_cat, 10, v_today + 2, v_site);`, '%DATE_FUTURE%', 'คีย์รายจ่ายวันในอนาคต → DATE_FUTURE')}
  v_j  := public.bot_create_expense(v_line, gen_random_uuid(), 10, v_today, v_site);
  v_j2 := public.bot_create_expense(v_line, v_cat, 10, v_today, gen_random_uuid());
  reset role;
  ${chk('R16-DB-40', `v_j->>'code' = 'CATEGORY_INVALID' and v_j2->>'code' = 'SITE_INVALID'`, 'หมวดหรือโครงการที่ไม่มี → CATEGORY_INVALID / SITE_INVALID (ไม่เขียนอะไร)', 'v_j::text || v_j2::text')}
  ${asService}
  ${expectErr('R16-DB-41', `perform public.bot_create_expense('U' || md5('nobody'), v_cat, 10, v_today);`, '%line_not_owner%', 'LINE ที่ไม่ใช่เจ้าของคีย์รายจ่าย → line_not_owner')}
  v_j := public.bot_expense_options(v_line);
  reset role;
  ${chk('R16-L4-01', `exists (select 1 from jsonb_array_elements(v_j->'categories') c where c->>'id' = v_cat::text)
       and exists (select 1 from jsonb_array_elements(v_j->'sites') s where s->>'id' = v_site::text)`,
    'bot_expense_options: หมวดรายจ่ายและโครงการที่เปิดอยู่ครบ', 'left(v_j::text, 200)')}

  -- ── เมนู 4 · เบี้ยเลี้ยงรายคน ────────────────────────────────────────
  ${asService}
  v_j := public.bot_allowance_presets(v_line);
  v_j2 := public.bot_allowance_people(v_line, v_today, v_preset);
  reset role;
  ${chk('R16-L3-04', `exists (select 1 from jsonb_array_elements(v_j->0 || v_j) p where p->>'id' = v_preset::text and (p->>'amount')::numeric = 300)`,
    'bot_allowance_presets: มีรายการที่ตั้งไว้พร้อมยอด', 'left(v_j::text, 200)')}
  select count(*) into v_n from jsonb_array_elements(v_j2->'people') p where p->>'name' like 'R16 %' and not (p->>'given')::boolean;
  ${chk('R16-L3-01', `(v_j2->>'ok')::boolean and v_n = 3`, 'รายชื่อคนลงชื่อวันนั้น: 3 คน ยังไม่มีใครได้ (ไม่ติ๊กให้ก่อน)', 'v_n::text')}

  ${asService}
  v_j := public.bot_allowance_give(v_line, v_today, v_preset, array[v_e1]);
  reset role;
  select ot_amount into v_num from public.attendance_wages where attendance_id = v_att;
  ${chk('R16-L3-05', `jsonb_exists(v_j->'given', 'R16 คน1') and v_num = 300`,
    'ให้เบี้ยเลี้ยง 1 คน → given · ot_amount ขึ้น ฿300 ตาม trigger เดิม', 'v_j::text')}

  ${asService}
  v_j := public.bot_allowance_give(v_line, v_today, v_preset, array[v_e1, v_e2]);
  v_j2 := public.bot_allowance_people(v_line, v_today, v_preset);
  reset role;
  select ot_amount into v_num from public.attendance_wages where attendance_id = v_att;
  select count(*) into v_n from jsonb_array_elements(v_j2->'people') p where p->>'name' in ('R16 คน1', 'R16 คน2') and (p->>'given')::boolean;
  ${chk('R16-L3-03', `jsonb_exists(v_j->'already', 'R16 คน1') and jsonb_exists(v_j->'given', 'R16 คน2') and v_num = 300 and v_n = 2`,
    'ให้ซ้ำ → already (ไม่บวกซ้ำ ยังคง ฿300) · ธง given ขึ้นทั้งสองคน', 'v_j::text')}

  ${asService}
  v_j := public.bot_allowance_give(v_line, v_today, v_preset, array[v_e4]);
  reset role;
  ${chk('R16-DB-42', `jsonb_exists(v_j->'no_attendance', 'R16 คน4') and jsonb_array_length(v_j->'given') = 0`, 'คนที่วันนั้นไม่ได้ลงชื่อ → no_attendance · ไม่บันทึก', 'v_j::text')}

  -- วันที่จ่ายค่าแรงไปแล้ว → ข้ามคนนั้น แต่คนอื่นยังบันทึก
  begin
    ${asSuper('v_owner')}
    perform public.pay_employee_wage(v_e3);
    insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_site, v_e4, 1);
    ${asService}
    v_j := public.bot_allowance_give(v_line, v_today, v_preset, array[v_e3, v_e4]);
    reset role;
    ${chk('R16-L3-06', `jsonb_exists(v_j->'blocked', 'R16 คน3') and jsonb_exists(v_j->'given', 'R16 คน4')`,
      'คนที่จ่ายค่าแรงวันนั้นไปแล้วถูกข้าม (blocked · บอกชื่อ) · คนอื่นในชุดยังบันทึก', 'v_j::text')}
  exception when others then
    reset role;
    v_fail := v_fail + 1; v_out := v_out || format(E'❌ R16-L3-06 ตั้งฟิกซ์เจอร์จ่ายค่าแรงไม่ได้: %s\\n', sqlerrm);
  end;

  ${asService}
  ${expectErr('R16-L3-07', `perform public.bot_allowance_give(v_line, v_today + 2, v_preset, array[v_e1]);`, '%DATE_FUTURE%', 'ให้เบี้ยเลี้ยงวันในอนาคต → DATE_FUTURE')}
  v_j := public.bot_allowance_give(v_line, v_today, gen_random_uuid(), array[v_e1]);
  v_j2 := public.bot_allowance_people(v_line, v_today, gen_random_uuid());
  reset role;
  ${chk('R16-DB-43', `v_j->>'code' = 'PRESET_NOT_FOUND' and v_j2->>'code' = 'PRESET_NOT_FOUND'`, 'รายการปรับที่ไม่มี/ปิดอยู่ → PRESET_NOT_FOUND ทั้ง give และ people', 'v_j::text || v_j2::text')}
${TAIL}`

// ═══ ก้อน D · ใครจ่ายเงินไป · เมนูค่าแรงคงค้าง · วันลงชื่อสองโครงการ (30 ก.ย. 2569) ═══
const BLOCK_D = `${HEAD('R16-L4/L6 · ใครจ่ายเงินไป · ค่าแรงคงค้าง · ครึ่ง+ครึ่ง').replace('v_j2     jsonb;', `v_j2     jsonb;
  v_line   text := 'U' || md5('r16-main');
  v_s1 uuid; v_s2 uuid; v_s3 uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid;
  v_cat  uuid;
  v_txn  uuid;
  v_bool boolean;
  v_num  numeric;`)}
  delete from public.line_accounts where profile_id = v_owner;
  insert into public.line_accounts(line_user_id, profile_id) values (v_line, v_owner);
  insert into public.sites(name, status) values ('R16 ตรวจ ก', 'active') returning id into v_s1;
  insert into public.sites(name, status) values ('R16 ตรวจ ข', 'active') returning id into v_s2;
  insert into public.sites(name, status) values ('R16 ตรวจ ค', 'active') returning id into v_s3;
  insert into public.employees(full_name, job_title) values ('R16 ครึ่งครึ่ง', 'ช่าง') returning id into v_e1;
  insert into public.employees(full_name, job_title, is_active) values ('R16 ปิดแล้ว', 'ช่าง', false) returning id into v_e2;
  insert into public.employees(full_name, job_title) values ('R16 ย้ายโครงการ', 'ช่าง') returning id into v_e3;
  insert into public.employee_wages(employee_id, wage_type, daily_rate)
    select id, 'daily', 600 from public.employees where id in (v_e1, v_e2, v_e3);
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_s1, v_e1, 0.5);
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_s2, v_e1, 0.5);
  insert into public.attendance(work_date, site_id, employee_id, work_units) values (v_today, v_s1, v_e3, 1);
  select id into v_cat from public.categories where kind = 'expense' and is_active order by sort_order, name limit 1;
  if v_cat is null then
    insert into public.categories(name, kind) values ('R16 หมวดตรวจ', 'expense') returning id into v_cat;
  end if;
  ${asAuth('v_owner')}
  insert into public.advances(employee_id, amount, advance_date, note) values (v_e1, 200, v_today, 'R16 เบิก');
  reset role;

  -- ── เมนู 1 · ใครจ่ายเงินไป ──────────────────────────────────────────
  ${asService}
  v_j := public.bot_create_expense(v_line, v_cat, 150, v_today, v_s1, 'transfer', 'น้ำแข็ง', gen_random_uuid(), v_e1);
  reset role;
  v_txn := (v_j->>'transaction_id')::uuid;
  select (owed_employee_id = v_e1 and owed_kind::text = 'reimburse' and status::text = 'approved'
          and pay_method::text = 'transfer' and settled_run_id is null)
    into v_bool from public.transactions where id = v_txn;
  ${chk('R16-L4-08', `(v_j->>'ok')::boolean and v_j->>'employee' = 'R16 ครึ่งครึ่ง' and v_bool`,
    'คีย์รายจ่ายพร้อม "ใครจ่ายเงินไป" = คนงาน → owed_employee_id · owed_kind=reimburse · approved · โอน', 'v_j::text')}
  ${asService}
  v_j := public.bot_create_expense(v_line, v_cat, 10, v_today, v_s1, 'transfer', null, gen_random_uuid(), v_e2);
  v_j2 := public.bot_expense_options(v_line);
  reset role;
  ${chk('R16-DB-46', `v_j->>'code' = 'EMPLOYEE_INVALID'`, 'คนงานที่ปิดใช้งานแล้ว → EMPLOYEE_INVALID (ไม่เขียน)', 'v_j::text')}
  ${chk('R16-L4-11', `exists (select 1 from jsonb_array_elements(v_j2->'employees') e where e->>'id' = v_e1::text)
       and not exists (select 1 from jsonb_array_elements(v_j2->'employees') e where e->>'id' = v_e2::text)`,
    'bot_expense_options: รายชื่อคนงานมีเฉพาะคนที่ยังใช้งาน', 'left(v_j2::text, 200)')}

  -- ── เมนู 5 · ค่าแรงคงค้าง ────────────────────────────────────────────
  ${asService}
  v_j := public.bot_wage_list(v_line);
  v_j2 := public.bot_wage_detail(v_line, v_e1);
  reset role;
  select (x->>'balance')::numeric into v_num from jsonb_array_elements(v_j) x where x->>'id' = v_e1::text;
  ${chk('R16-L6-01', `v_num = 550`, 'รายชื่อค่าแรงคงค้าง: ค่าแรง 600 + ออกเงินให้ก่อน 150 − เบิก 200 = 550', "coalesce(v_num::text, 'ไม่พบ')")}
  ${asAuth('v_owner')}
  select b.balance into v_num from public.payroll_balances() b where b.employee_id = v_e1;
  reset role;
  ${chk('R16-L6-02', `(v_j2->>'ok')::boolean and (v_j2->>'balance')::numeric = v_num
       and jsonb_array_length(v_j2->'sites') = 2
       and (select bool_and((s->>'units')::numeric = 0.5 and (s->>'amount')::numeric = 300) from jsonb_array_elements(v_j2->'sites') s)
       and jsonb_array_length(v_j2->'owed_items') = 1 and (v_j2->>'owed')::numeric = 150
       and jsonb_array_length(v_j2->'advances') = 1 and (v_j2->'advances'->0->>'open')::numeric = 200
       and (v_j2->>'days')::numeric = 1`,
    'ใบสรุป: ยอดตรงกับ payroll_balances() · ครึ่งวันสองโครงการ (300+300) · รายการออกก่อน 1 · ใบเบิก 1 · รวม 1 แรง', 'left(v_j2::text, 300)')}
  ${asService}
  v_j := public.bot_wage_detail(v_line, v_e3);
  v_j2 := public.bot_wage_detail(v_line, gen_random_uuid());
  reset role;
  ${chk('R16-L6-03', `(v_j->>'ok')::boolean and v_j2->>'code' = 'NOTHING'`, 'คนที่ไม่มียอดค้าง → NOTHING (ไม่ใช่ใบที่เป็นศูนย์)', 'v_j2::text')}
  ${asService}
  ${expectErr('R16-L6-04', `perform public.bot_wage_list('U' || md5('nobody'));`, '%line_not_owner%', 'LINE ที่ไม่ใช่เจ้าของดูค่าแรงคงค้างไม่ได้ → line_not_owner')}
  reset role;
  ${chk('R16-L6-05', `not has_function_privilege('authenticated', 'public.bot_wage_detail(text, uuid)', 'execute')
       and not has_function_privilege('anon', 'public.bot_wage_list(text)', 'execute')
       and not has_function_privilege('authenticated', 'public.bot_create_expense(text, uuid, numeric, date, uuid, text, text, uuid, uuid)', 'execute')
       and has_function_privilege('service_role', 'public.bot_wage_detail(text, uuid)', 'execute')`,
    'ฟังก์ชันใหม่ของบอทเรียกได้เฉพาะ service_role (ยอดค่าแรงรายคนไม่หลุดถึงหัวหน้าโครงการ)', `'สิทธิ์ผิด'`)}

  -- ── วันลงชื่อสองโครงการ · ตารางการทำงานต้องไม่ลบอีกครึ่ง ─────────────
  ${asAuth('v_owner')}
  perform public.save_attendance_day(v_e1, v_s1, v_today, 0.5, 650);
  reset role;
  select count(*) into v_n from public.attendance where employee_id = v_e1 and work_date = v_today;
  select aw.wage_snapshot into v_num from public.attendance a join public.attendance_wages aw on aw.attendance_id = a.id
   where a.employee_id = v_e1 and a.site_id = v_s1 and a.work_date = v_today;
  ${chk('R16-ATT-01', `v_n = 2 and v_num = 650`, 'แก้ค่าแรงของโครงการหนึ่งในวันที่ลงสองโครงการ → อีกโครงการยังอยู่ (เดิมถูกลบเงียบ ๆ)', `format('%s แถว · %s', v_n, v_num)`)}
  ${asAuth('v_owner')}
  ${expectErr('R16-ATT-02', `perform public.save_attendance_day(v_e1, v_s3, v_today, 0.5, 600);`, '%MULTI_SITE_DAY%', 'บันทึกโครงการที่สามทับวันที่มีสองโครงการ → MULTI_SITE_DAY (ไม่ลบของเดิม)')}
  perform public.save_attendance_day(v_e3, v_s2, v_today, 1, 600);
  reset role;
  select count(*) filter (where site_id = v_s2), count(*) into v_n, v_n2 from public.attendance where employee_id = v_e3 and work_date = v_today;
  ${chk('R16-ATT-03', `v_n = 1 and v_n2 = 1`, 'วันที่มีโครงการเดียว → ย้ายไปโครงการใหม่ได้เหมือนเดิม', `format('%s / %s', v_n, v_n2)`)}
  ${asAuth('v_owner')}
  perform public.save_attendance_day(v_e3, v_s2, v_today, 1, 720);
  reset role;
  select aw.wage_snapshot into v_num from public.attendance a join public.attendance_wages aw on aw.attendance_id = a.id
   where a.employee_id = v_e3 and a.site_id = v_s2 and a.work_date = v_today;
  ${chk('R16-ATT-04', `v_num = 720`, 'แก้ค่าแรงของวันที่ลงเต็มวันไว้แล้ว → บันทึกได้ (เดิมโดน WORK_UNITS_EXCEEDED ทุกครั้ง)', "coalesce(v_num::text, 'ไม่พบ')")}
${TAIL}`

// ── รัน ─────────────────────────────────────────────────────────────────
console.log('\n── R16 · LINE bot (ฐานข้อมูล) ────────────────────────────────')

let passN = 0
let failN = 0

for (const [i, sql] of [BLOCK_A, BLOCK_B, BLOCK_C, BLOCK_D].entries()) {
  const { rolledBack, message } = await run(sql)
  if (!rolledBack) {
    failN += 1
    console.log(`  ❌ ก้อนที่ ${i + 1} ไม่ได้ถูก rollback — ตรวจของค้างในฐานทันที`)
    continue
  }
  const lines = message.split('\n').map((l) => l.trim())
  const marks = lines.filter((l) => l.startsWith('✅') || l.startsWith('❌'))
  if (marks.length === 0) {
    failN += 1
    console.log(`  ❌ ก้อนที่ ${i + 1} ไม่มีรายงาน — error ดิบ: ${message.slice(0, 400)}`)
    continue
  }
  for (const t of marks) {
    if (t.startsWith('✅')) passN += 1
    else failN += 1
    console.log(`  ${t}`)
  }
}

console.log(`\n  ${passN}/${passN + failN} ผ่าน · ไม่มีแถวไหนถูกเขียนค้างไว้`)
process.exitCode = failN === 0 ? 0 : 1
