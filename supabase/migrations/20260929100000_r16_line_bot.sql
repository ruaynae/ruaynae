-- R16 · สั่งงานผ่าน LINE bot (เจ้าของเท่านั้น)
--
-- แบบอ้างอิง: C:\projects\huay (p15_line_schema) · ที่ต่างคือ
--   · คีย์ LINE (channel secret / access token) เจ้าของกรอกเองที่หน้าตั้งค่า
--     เก็บใน **Supabase Vault** ไม่ใช่ env ไม่ใช่ตารางธรรมดา
--   · ใช้ได้เฉพาะ role owner — `_bot_as()` ปฏิเสธคนอื่นทุกกรณี
--   · การเขียนทุกครั้งสวมสิทธิ์เจ้าของแล้วเรียกกติกาเดิม (guard trigger ทำงานครบ)
--     และผูกป้าย "บันทึกผ่าน LINE" ผ่าน GUC `app.via_line`
--
-- 🔴 ตารางทั้งหมดของฝั่งบอท revoke จาก anon/authenticated · ฟังก์ชัน bot_* เรียกได้
-- เฉพาะ service_role · ตัวที่เจ้าของกดในหน้าตั้งค่า (set_line_keys ฯลฯ) เช็ค is_owner() เอง

-- ── 0 · ตารางของบอท ──────────────────────────────────────────────────
create table if not exists public.line_accounts (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text not null unique check (line_user_id ~ '^U[0-9a-f]{32}$'),
  profile_id    uuid not null unique references public.profiles(id) on delete cascade,
  display_name  text,
  created_at    timestamptz not null default now()
);
alter table public.line_accounts enable row level security;
revoke all on public.line_accounts from public, anon, authenticated;
grant select on public.line_accounts to authenticated;
drop policy if exists line_accounts_owner_read on public.line_accounts;
create policy line_accounts_owner_read on public.line_accounts
  for select to authenticated using ((select public.is_owner()));

create table if not exists public.line_link_codes (
  id          uuid primary key default gen_random_uuid(),
  code_hash   bytea not null,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists line_link_codes_hash_idx on public.line_link_codes(code_hash);
create index if not exists line_link_codes_profile_idx on public.line_link_codes(profile_id);
alter table public.line_link_codes enable row level security;
revoke all on public.line_link_codes from public, anon, authenticated;

create table if not exists public.line_link_failures (
  id            bigint generated always as identity primary key,
  line_user_id  text not null,
  at            timestamptz not null default now()
);
create index if not exists line_link_failures_user_idx on public.line_link_failures(line_user_id, at desc);
alter table public.line_link_failures enable row level security;
revoke all on public.line_link_failures from public, anon, authenticated;

create table if not exists public.line_events (
  webhook_event_id text primary key,
  received_at      timestamptz not null default now()
);
create index if not exists line_events_received_idx on public.line_events(received_at);
alter table public.line_events enable row level security;
revoke all on public.line_events from public, anon, authenticated;

create table if not exists public.line_sessions (
  line_user_id text primary key,
  state        text not null,
  payload      jsonb not null default '{}'::jsonb,
  expires_at   timestamptz not null,
  updated_at   timestamptz not null default now()
);
alter table public.line_sessions enable row level security;
revoke all on public.line_sessions from public, anon, authenticated;

-- ข้อความขาออกของโหมดทดสอบ (LINE_API_FAKE) — ไม่ยิง LINE จริง เขียนลงตารางนี้แทน
create table if not exists public.line_outbox_test (
  id          bigint generated always as identity primary key,
  kind        text not null,
  to_user     text,
  body        jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.line_outbox_test enable row level security;
revoke all on public.line_outbox_test from public, anon, authenticated;

drop trigger if exists line_accounts_audit on public.line_accounts;
create trigger line_accounts_audit after insert or update or delete on public.line_accounts
  for each row execute function public.audit_row();

-- ── 1 · ป้ายที่มา "บันทึกผ่าน LINE" ───────────────────────────────────
-- 🔴 audit_log.via_line ไม่มี FK (เหตุผลเดียวกับ mcp_key_id — §17 ข้อ 19)
alter table public.transactions add column if not exists via_line boolean not null default false;
alter table public.audit_log    add column if not exists via_line boolean not null default false;
create index if not exists audit_log_via_line_idx on public.audit_log(at desc) where via_line;

create or replace function public.keep_via_line()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.via_line := old.via_line;
  return new;
end $$;
revoke execute on function public.keep_via_line() from public, anon, authenticated;

drop trigger if exists transactions_keep_via_line on public.transactions;
create trigger transactions_keep_via_line before update on public.transactions
  for each row execute function public.keep_via_line();

-- 🔴 คัดลอกมาทั้งดุ้นจาก 20260901170000_r6_mcp_write.sql · ที่เพิ่มคือ v_line กับ
-- คอลัมน์ที่ 8 ของ insert เท่านั้น · ⚠️ ห้ามลบ `- 'pin_hash' - 'key_hash'`
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_row_id text;
  v_key    uuid;
  v_line   boolean;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
    v_after  := null;
    v_row_id := v_before->>'id';
  elsif tg_op = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(new);
    v_row_id := v_after->>'id';
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    v_row_id := v_after->>'id';
  end if;

  v_before := v_before - 'pin_hash' - 'key_hash';
  v_after  := v_after  - 'pin_hash' - 'key_hash';

  v_key  := nullif(current_setting('app.mcp_key_id', true), '')::uuid;
  -- ⚠️ ต้องมี `true` (missing_ok) ไม่งั้นทุก trigger ของทั้งระบบพังตอนไม่มีค่า
  v_line := coalesce(nullif(current_setting('app.via_line', true), '') = '1', false);

  insert into public.audit_log(table_name, row_id, action, actor, before, after, mcp_key_id, via_line)
  values (tg_table_name, v_row_id, tg_op, auth.uid(), v_before, v_after, v_key, v_line);

  return null;
end $$;

-- ── 2 · คิวแจ้งเตือน LINE (ส่งรวบต่อรอบ cron) ─────────────────────────
-- ไม่ backfill โดยตั้งใจ: ตัวส่งกรอง created_at >= วันที่เชื่อม LINE แทน
-- (การ update ทั้งตารางจะยิง audit trigger ทุกแถวเปล่า ๆ)
alter table public.notifications add column if not exists line_pushed_at timestamptz;
create index if not exists notifications_line_pending_idx on public.notifications(created_at)
  where line_pushed_at is null and kind in ('txn_pending','advance_pending');

-- ── 3 · คีย์ LINE ใน Vault (เจ้าของกรอกที่หน้าตั้งค่า) ─────────────────
-- ไม่ส่งคีย์กลับออกไปเป็นข้อความจริงที่ไหนเลย — โชว์ได้แค่ 4 ตัวท้าย
create or replace function public.set_line_keys(p_secret text, p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text := nullif(btrim(coalesce(p_secret, '')), '');
  v_token  text := nullif(btrim(coalesce(p_token, '')), '');
  v_id     uuid;
  v_changed text[] := '{}';
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- ช่องที่เว้นว่าง = คงค่าเดิมไว้ (เจ้าของแก้ทีละช่องได้ ไม่ต้องกรอกสองช่องซ้ำ)
  if v_secret is not null then
    if length(v_secret) not between 20 and 100 or v_secret ~ '\s' then
      raise exception 'line_key_invalid' using detail = 'secret';
    end if;
    select id into v_id from vault.secrets where name = 'line_channel_secret';
    if v_id is null then
      perform vault.create_secret(v_secret, 'line_channel_secret', 'LINE Channel secret');
    else
      perform vault.update_secret(v_id, v_secret);
    end if;
    v_changed := array_append(v_changed, 'secret');
  end if;

  if v_token is not null then
    if length(v_token) not between 40 and 400 or v_token ~ '\s' then
      raise exception 'line_key_invalid' using detail = 'token';
    end if;
    select id into v_id from vault.secrets where name = 'line_channel_access_token';
    if v_id is null then
      perform vault.create_secret(v_token, 'line_channel_access_token', 'LINE Channel access token');
    else
      perform vault.update_secret(v_id, v_token);
    end if;
    v_changed := array_append(v_changed, 'token');
  end if;

  if array_length(v_changed, 1) is not null then
    -- ร่องรอยว่าใครเปลี่ยนคีย์ตอนไหน · บันทึกแค่ชื่อช่อง ไม่มีค่าคีย์เด็ดขาด
    insert into public.audit_log(table_name, row_id, action, actor, before, after)
    values ('line_keys', null, 'UPDATE', auth.uid(), null, jsonb_build_object('changed', v_changed));
  end if;
end $$;
revoke execute on function public.set_line_keys(text, text) from public, anon;
grant  execute on function public.set_line_keys(text, text) to authenticated;

create or replace function public.line_key_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select jsonb_object_agg(k.name, jsonb_build_object(
           'set', d.decrypted_secret is not null,
           'last4', case when d.decrypted_secret is null then null
                         else right(d.decrypted_secret, 4) end))
    into v
  from (values ('channel_secret'), ('access_token')) as k(name)
  left join vault.decrypted_secrets d
    on d.name = case k.name when 'channel_secret' then 'line_channel_secret'
                            else 'line_channel_access_token' end;
  return v;
end $$;
revoke execute on function public.line_key_status() from public, anon;
grant  execute on function public.line_key_status() to authenticated;

-- ตัวอ่านคีย์จริง — เฉพาะเซิร์ฟเวอร์ (service_role) · ห้ามให้ authenticated เด็ดขาด
create or replace function public._line_key(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v text;
begin
  if p_name not in ('line_channel_secret', 'line_channel_access_token') then
    raise exception 'line_key_unknown';
  end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = p_name;
  return v;
end $$;
revoke execute on function public._line_key(text) from public, anon, authenticated;
grant  execute on function public._line_key(text) to service_role;

-- ── 4 · เชื่อม/ยกเลิกบัญชี LINE ──────────────────────────────────────
create or replace function public.create_line_link_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_uid  uuid := auth.uid();
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- รหัสใหม่แทนรหัสเก่าเสมอ — กันรหัสที่ค้างอยู่หลายอัน
  delete from public.line_link_codes where profile_id = v_uid;
  v_code := lpad(
    ((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32))::bigint % 1000000)::text,
    6, '0');
  insert into public.line_link_codes(code_hash, profile_id, expires_at)
  values (extensions.digest(v_code, 'sha256'), v_uid, now() + interval '10 minutes');
  return v_code;
end $$;
revoke execute on function public.create_line_link_code() from public, anon;
grant  execute on function public.create_line_link_code() to authenticated;

create or replace function public.unlink_line_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.line_accounts where profile_id = auth.uid();
  delete from public.line_link_codes where profile_id = auth.uid();
end $$;
revoke execute on function public.unlink_line_account() from public, anon;
grant  execute on function public.unlink_line_account() to authenticated;

-- ── 5 · ฟังก์ชันของบอท (service_role เท่านั้น) ────────────────────────
-- สวมสิทธิ์เจ้าของของบัญชี LINE นั้น · โยน line_not_owner ถ้าไม่ใช่เจ้าของที่ยังใช้งานอยู่
create or replace function public._bot_as(p_line_user text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile uuid;
begin
  select a.profile_id into v_profile
  from public.line_accounts a
  join public.profiles p on p.id = a.profile_id and p.role = 'owner' and p.is_active
  where a.line_user_id = p_line_user;
  if v_profile is null then
    raise exception 'line_not_owner';
  end if;

  -- ⚠️ ต้อง **ผสม** claims ไม่ใช่เขียนทับ (ดู mcp_assume_owner)
  perform set_config(
    'request.jwt.claims',
    (coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
       || jsonb_build_object('sub', v_profile::text, 'role', 'authenticated'))::text,
    true);
  perform set_config('app.via_line', '1', true);
  return v_profile;
end $$;
revoke execute on function public._bot_as(text) from public, anon, authenticated;
grant  execute on function public._bot_as(text) to service_role;

create or replace function public.bot_whoami(p_line_user text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('linked', true, 'name', p.full_name)
       from public.line_accounts a
       join public.profiles p on p.id = a.profile_id and p.role = 'owner' and p.is_active
      where a.line_user_id = p_line_user),
    jsonb_build_object('linked', false));
$$;

create or replace function public.bot_link(p_line_user text, p_code text, p_display text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code_id uuid;
  v_profile uuid;
  v_name    text;
begin
  -- ล็อกเมื่อเดารหัสผิดเกิน 5 ครั้งใน 1 ชั่วโมง (รหัส 6 หลักมีแค่ล้านความเป็นไปได้)
  if (select count(*) from public.line_link_failures
       where line_user_id = p_line_user and at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('ok', false, 'locked', true);
  end if;

  select c.id, c.profile_id into v_code_id, v_profile
  from public.line_link_codes c
  where c.code_hash = extensions.digest(coalesce(p_code, ''), 'sha256')
    and c.used_at is null and c.expires_at > now()
  order by c.created_at desc
  limit 1
  for update;

  if v_code_id is null then
    insert into public.line_link_failures(line_user_id) values (p_line_user);
    return jsonb_build_object('ok', false);
  end if;

  select p.full_name into v_name
  from public.profiles p where p.id = v_profile and p.role = 'owner' and p.is_active;
  if v_name is null then
    insert into public.line_link_failures(line_user_id) values (p_line_user);
    return jsonb_build_object('ok', false);
  end if;

  -- LINE หนึ่งบัญชีผูกได้หนึ่งเจ้าของ และเจ้าของหนึ่งคนมี LINE ได้หนึ่งบัญชี — เชื่อมใหม่ = แทนที่
  delete from public.line_accounts where profile_id = v_profile or line_user_id = p_line_user;
  insert into public.line_accounts(line_user_id, profile_id, display_name)
  values (p_line_user, v_profile, nullif(btrim(coalesce(p_display, '')), ''));
  update public.line_link_codes set used_at = now() where id = v_code_id;
  delete from public.line_link_failures where line_user_id = p_line_user;
  return jsonb_build_object('ok', true, 'name', v_name);
end $$;

-- true = เคยเห็น event นี้แล้ว (LINE ส่งซ้ำได้) → ข้าม
create or replace function public.bot_event_seen(p_event_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if p_event_id is null or p_event_id = '' then
    return false;
  end if;
  insert into public.line_events(webhook_event_id) values (p_event_id)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n = 0;
end $$;

create or replace function public.bot_session_get(p_line_user text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.line_sessions%rowtype;
begin
  select * into r from public.line_sessions where line_user_id = p_line_user;
  if not found then
    return null;
  end if;
  if r.expires_at <= now() then
    delete from public.line_sessions where line_user_id = p_line_user;
    return null;
  end if;
  return jsonb_build_object('state', r.state, 'payload', r.payload);
end $$;

-- p_state null = ล้างเซสชัน
create or replace function public.bot_session_set(
  p_line_user text, p_state text, p_payload jsonb default '{}'::jsonb, p_ttl_sec int default 900)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_state is null then
    delete from public.line_sessions where line_user_id = p_line_user;
    return;
  end if;
  insert into public.line_sessions(line_user_id, state, payload, expires_at, updated_at)
  values (p_line_user, p_state, coalesce(p_payload, '{}'::jsonb),
          now() + make_interval(secs => greatest(p_ttl_sec, 30)), now())
  on conflict (line_user_id) do update
    set state = excluded.state, payload = excluded.payload,
        expires_at = excluded.expires_at, updated_at = now();
end $$;

-- ต่อรายการเข้า array ในเซสชันแบบอะตอมมิก (รูปหลายรูปเข้ามาพร้อมกันจากหลาย webhook)
-- คืน jsonb ของ array หลังต่อ · null = ไม่มีเซสชัน หรือเซสชันไม่ได้อยู่ในสถานะที่ระบุ
create or replace function public.bot_session_append(
  p_line_user text, p_state text, p_key text, p_item jsonb, p_max int default 4)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   public.line_sessions%rowtype;
  arr jsonb;
begin
  select * into r from public.line_sessions
   where line_user_id = p_line_user and state = p_state and expires_at > now()
   for update;
  if not found then
    return null;
  end if;
  arr := coalesce(r.payload -> p_key, '[]'::jsonb);
  if jsonb_array_length(arr) >= p_max then
    return jsonb_build_object('full', true, 'items', arr);
  end if;
  arr := arr || jsonb_build_array(p_item);
  update public.line_sessions
     set payload = jsonb_set(payload, array[p_key], arr), updated_at = now()
   where line_user_id = p_line_user;
  return jsonb_build_object('full', false, 'items', arr);
end $$;

-- ── 6 · เมนู 2 · ใครเข้าโครงการไหนวันนี้ (ไม่มียอดเงิน) ────────────────
create or replace function public.bot_attendance_today(p_line_user text, p_on date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sites jsonb;
  v_empty jsonb;
  v_total int;
begin
  perform public._bot_as(p_line_user);

  select coalesce(jsonb_agg(x order by x->>'name'), '[]'::jsonb) into v_sites
  from (
    select jsonb_build_object(
             'site_id', s.id, 'name', s.name,
             'people', (
               select jsonb_agg(jsonb_build_object(
                        'name', e.full_name, 'job', e.job_title, 'units', a.work_units)
                      order by e.full_name)
               from public.attendance a
               join public.employees e on e.id = a.employee_id
               where a.site_id = s.id and a.work_date = p_on)) as x
    from public.sites s
    where exists (select 1 from public.attendance a
                   where a.site_id = s.id and a.work_date = p_on)
  ) q;

  select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) into v_empty
  from public.sites s
  where s.status = 'active'
    and not exists (select 1 from public.attendance a
                     where a.site_id = s.id and a.work_date = p_on);

  select count(distinct a.employee_id) into v_total
  from public.attendance a where a.work_date = p_on;

  return jsonb_build_object('date', p_on, 'sites', v_sites,
                            'empty_sites', v_empty, 'total_people', v_total);
end $$;

-- ── 7 · เมนู 3 · คิวรออนุมัติ (ใบเบิก + รายจ่ายของหัวหน้าโครงการ) ───────
create or replace function public.bot_queue(p_line_user text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adv  jsonb;
  v_exp  jsonb;
  v_advn int;
  v_expn int;
begin
  perform public._bot_as(p_line_user);

  select count(*) into v_advn from public.advances where status = 'pending';
  select count(*) into v_expn from public.transactions where status = 'pending';

  select coalesce(jsonb_agg(r order by r->>'created_at'), '[]'::jsonb) into v_adv
  from (
    select jsonb_build_object(
             'id', a.id, 'employee', e.full_name, 'amount', a.amount,
             'date', a.advance_date, 'site', s.name, 'by', p.full_name,
             'note', a.note, 'created_at', a.created_at) as r
    from public.advances a
    join public.employees e on e.id = a.employee_id
    left join public.sites s on s.id = a.site_id
    left join public.profiles p on p.id = a.created_by
    where a.status = 'pending'
    order by a.created_at
    limit 10
  ) q;

  select coalesce(jsonb_agg(r order by r->>'created_at'), '[]'::jsonb) into v_exp
  from (
    select jsonb_build_object(
             'id', t.id, 'kind', t.kind, 'amount', t.amount, 'date', t.txn_date,
             'category', c.name, 'site', s.name, 'by', p.full_name, 'note', t.note,
             'slips', (select count(*) from public.attachments at2 where at2.transaction_id = t.id),
             'created_at', t.created_at) as r
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    left join public.sites s on s.id = t.site_id
    left join public.profiles p on p.id = t.created_by
    where t.status = 'pending'
    order by t.created_at
    limit 10
  ) q;

  return jsonb_build_object('advances', v_adv, 'expenses', v_exp,
                            'advance_count', v_advn, 'expense_count', v_expn);
end $$;

-- อนุมัติ/ตีกลับ — เปลี่ยน status ในฐานะเจ้าของ กติกา guard เดิมทำงานครบ
-- (ตั้ง approved_by/at · ส่งแจ้งเตือนกลับหาหัวหน้าโครงการ · ห้ามแตะใบที่หักคืนแล้ว)
-- คืน jsonb แทนการโยน เมื่อเป็นกรณีที่คาดไว้ (ทำไปแล้ว/ไม่พบ) เพื่อให้บอทตอบเป็นภาษาคนได้
create or replace function public.bot_approve(
  p_line_user text, p_kind text, p_id uuid, p_action text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_label  text;
begin
  perform public._bot_as(p_line_user);

  if p_action not in ('approve', 'reject') or p_kind not in ('advance', 'expense') then
    raise exception 'BAD_REQUEST';
  end if;
  if p_action = 'reject' and v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  v_reason := left(v_reason, 500);

  if p_kind = 'advance' then
    select a.status::text, e.full_name || ' ฿' || trim(to_char(a.amount, 'FM999,999,990.00'))
      into v_status, v_label
    from public.advances a join public.employees e on e.id = a.employee_id
    where a.id = p_id for update of a;
  else
    select t.status::text, coalesce(c.name, 'รายการ') || ' ฿' || trim(to_char(t.amount, 'FM999,999,990.00'))
      into v_status, v_label
    from public.transactions t left join public.categories c on c.id = t.category_id
    where t.id = p_id for update of t;
  end if;

  if v_status is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_' || upper(v_status), 'label', v_label);
  end if;

  if p_kind = 'advance' then
    if p_action = 'approve' then
      update public.advances set status = 'approved', rejected_reason = null where id = p_id;
    else
      update public.advances set status = 'rejected', rejected_reason = v_reason where id = p_id;
    end if;
  else
    if p_action = 'approve' then
      update public.transactions set status = 'approved', rejected_reason = null where id = p_id;
    else
      update public.transactions set status = 'rejected', rejected_reason = v_reason where id = p_id;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'action', p_action, 'label', v_label);
end $$;

-- ── 8 · เมนู 4 · เบี้ยเลี้ยง เลือกทีละคน ─────────────────────────────
create or replace function public.bot_allowance_presets(p_line_user text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._bot_as(p_line_user);
  return (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', w.id, 'name', w.name, 'amount', w.amount)
                 order by w.sort_order, w.name), '[]'::jsonb)
            from public.wage_adjustment_presets w
           where w.is_active and w.kind = 'add');
end $$;

-- คนที่ลงชื่อเข้าโครงการในวันนั้น + ธง "ได้แล้ว" (มีรายการปรับจากรายการสำเร็จรูปนี้อยู่แล้ว)
create or replace function public.bot_allowance_people(p_line_user text, p_on date, p_preset uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preset jsonb;
  v_people jsonb;
begin
  perform public._bot_as(p_line_user);

  select jsonb_build_object('id', w.id, 'name', w.name, 'amount', w.amount)
    into v_preset
  from public.wage_adjustment_presets w where w.id = p_preset and w.is_active and w.kind = 'add';
  if v_preset is null then
    return jsonb_build_object('ok', false, 'code', 'PRESET_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', q.employee_id, 'name', q.name, 'sites', q.sites, 'given', q.given)
         order by q.name), '[]'::jsonb)
    into v_people
  from (
    select e.id as employee_id, e.full_name as name,
           string_agg(distinct s.name, ', ') as sites,
           bool_or(exists (select 1 from public.attendance_adjustments ad
                            where ad.attendance_id = a.id and ad.preset_id = p_preset)) as given
    from public.attendance a
    join public.employees e on e.id = a.employee_id
    join public.sites s on s.id = a.site_id
    where a.work_date = p_on
    group by e.id, e.full_name
  ) q;

  return jsonb_build_object('ok', true, 'preset', v_preset, 'people', v_people);
end $$;

-- ให้ทีละหลายคน · คนที่ได้แล้วข้าม · คนที่วันนั้นจ่ายเงินไปแล้ว (PAYROLL_CLOSED) ข้ามและบอกชื่อ
-- คนที่เหลือยังบันทึกต่อ — ไม่ล้มทั้งก้อนเพราะคนเดียว
create or replace function public.bot_allowance_give(
  p_line_user text, p_on date, p_preset uuid, p_employee_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w        public.wage_adjustment_presets%rowtype;
  v_emp    uuid;
  v_name   text;
  v_att    uuid;
  v_given   jsonb := '[]'::jsonb;
  v_already jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_none    jsonb := '[]'::jsonb;
  v_today  date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform public._bot_as(p_line_user);

  if p_on > v_today then
    raise exception 'DATE_FUTURE: บันทึกของวันในอนาคตไม่ได้';
  end if;
  select * into w from public.wage_adjustment_presets
   where id = p_preset and is_active and kind = 'add';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRESET_NOT_FOUND');
  end if;

  foreach v_emp in array coalesce(p_employee_ids, '{}') loop
    select e.full_name into v_name from public.employees e where e.id = v_emp;
    if v_name is null then
      continue;
    end if;

    select a.id into v_att from public.attendance a
     where a.employee_id = v_emp and a.work_date = p_on
     order by a.created_at limit 1;
    if v_att is null then
      v_none := v_none || to_jsonb(v_name);
      continue;
    end if;

    if exists (select 1 from public.attendance_adjustments ad
                join public.attendance a2 on a2.id = ad.attendance_id
               where a2.employee_id = v_emp and a2.work_date = p_on and ad.preset_id = p_preset) then
      v_already := v_already || to_jsonb(v_name);
      continue;
    end if;

    begin
      insert into public.attendance_adjustments(attendance_id, preset_id, name, kind, amount)
      values (v_att, w.id, w.name, w.kind, w.amount);
      v_given := v_given || to_jsonb(v_name);
    exception when others then
      if sqlerrm like 'PAYROLL_CLOSED%' then
        v_blocked := v_blocked || to_jsonb(v_name);
      else
        raise;
      end if;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'preset', w.name, 'amount', w.amount,
    'given', v_given, 'already', v_already, 'blocked', v_blocked, 'no_attendance', v_none);
end $$;

-- ── 9 · เมนู 1 · คีย์รายจ่าย ─────────────────────────────────────────
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
                     from public.sites s where s.status in ('planning', 'active')));
end $$;

-- เหมือน mcp_create_transaction ฝั่งรายจ่าย: เจ้าของคีย์ = approved ทันที ·
-- client_ref กันกดซ้ำ · ผูกป้าย via_line (ไม่ใช่ mcp_key_id)
create or replace function public.bot_create_expense(
  p_line_user  text,
  p_category   uuid,
  p_amount     numeric,
  p_date       date,
  p_site       uuid    default null,
  p_pay_method text    default 'cash',
  p_note       text    default null,
  p_client_ref uuid    default null)
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

  if p_client_ref is not null then
    select t.id into v_id from public.transactions t where t.client_ref = p_client_ref;
    if found then
      return jsonb_build_object('ok', true, 'duplicate', true, 'transaction_id', v_id,
                                'category', v_cat, 'site', v_site);
    end if;
  end if;

  insert into public.transactions (
    kind, site_id, category_id, amount, txn_date, pay_method,
    note, client_ref, status, via_line)
  values (
    'expense', p_site, p_category, p_amount, p_date,
    coalesce(p_pay_method, 'cash')::public.pay_method,
    nullif(btrim(coalesce(p_note, '')), ''), p_client_ref, 'approved', true)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'duplicate', false, 'transaction_id', v_id,
                            'category', v_cat, 'site', v_site);

exception when unique_violation then
  select t.id into v_id from public.transactions t where t.client_ref = p_client_ref;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'transaction_id', v_id,
                              'category', v_cat, 'site', v_site);
  end if;
  raise;
end $$;

-- ── 10 · สิทธิ์: bot_* + _bot_as เรียกได้เฉพาะ service_role ────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'bot\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- ── 11 · เก็บกวาดรายวัน (pg_cron · UTC) — 03:15 เวลาไทย ────────────────
select cron.schedule(
  'line-events-clean', '15 20 * * *',
  $cron$
    delete from public.line_events where received_at < now() - interval '7 days';
    delete from public.line_link_failures where at < now() - interval '1 day';
    delete from public.line_link_codes where expires_at < now() - interval '1 day';
    delete from public.line_sessions where expires_at < now();
    delete from public.line_outbox_test where created_at < now() - interval '2 days';
  $cron$);
