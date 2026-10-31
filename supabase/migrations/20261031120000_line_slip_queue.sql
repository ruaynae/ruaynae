-- คิวสลิปของบอท LINE (31 ต.ค. 2569 · เจ้าของเลือก "ส่งรวดเดียว แล้วยืนยันทีละใบ")
--
-- ส่งสลิปหลายใบพร้อมกัน = หลาย webhook ขนานกัน · AI อ่านแต่ละใบ แล้ว:
--   ยังไม่มีรายจ่ายที่กำลังทำ → ใบนี้เป็นใบปัจจุบัน (เซสชัน exp_amount)
--   มีอยู่แล้ว → เข้าคิว (ตารางนี้) · บันทึก/ข้ามใบปัจจุบันแล้ว bot_slip_next() ดึงใบถัดไปขึ้นมา
-- 🔴 คิวแยกตารางจาก line_sessions.payload — การเขียนเซสชันของเทิร์นอื่นเขียน payload ทั้งก้อน
--    ถ้าคิวอยู่ใน payload สลิปที่ต่อเข้ามาระหว่างนั้นจะถูกทับหาย (§17 ข้อ 35)
-- 🔴 ใช้ advisory lock ตัวเดียวกับ bot_session_photo — รูปที่มาพร้อมกันเข้าแถวทีละรูป
-- ของค้างเกิน 24 ชม. ถูกทิ้ง (รูปใน R2 ถูกตัวกวาด upload_intents ลบเอง)

create table if not exists public.line_slip_queue (
  id           bigint generated always as identity primary key,
  line_user_id text not null,
  item         jsonb not null,
  created_at   timestamptz not null default now()
);
create index if not exists line_slip_queue_user_idx on public.line_slip_queue(line_user_id, id);
alter table public.line_slip_queue enable row level security;
revoke all on public.line_slip_queue from anon, authenticated;

-- สลิปที่ AI อ่านได้หนึ่งใบ → เป็นใบปัจจุบัน / ต่อรูปเข้าใบปัจจุบัน (เลขอ้างอิงเดียวกัน) / เข้าคิว
-- p_item = { slip, aiAmount, aiDate, aiNote, aiMemo, aiRef, aiLines }
create or replace function public.bot_slip_take(
  p_line_user text, p_item jsonb, p_max int default 10, p_max_photos int default 4, p_ttl_sec int default 1800)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      public.line_sessions%rowtype;
  v_n    int;
  v_cur  jsonb;
  v_pics jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('line_photo:' || p_line_user));
  delete from public.line_slip_queue
   where line_user_id = p_line_user and created_at < now() - interval '24 hours';
  select count(*) into v_n from public.line_slip_queue where line_user_id = p_line_user;

  select * into r from public.line_sessions
   where line_user_id = p_line_user and expires_at > now();

  -- ไม่มีรายจ่ายที่กำลังทำ → ใบนี้คือใบปัจจุบัน
  if not found or r.state not in ('exp_amount', 'exp_cat', 'exp_site', 'exp_confirm') then
    v_cur := jsonb_build_object('slips', jsonb_build_array(p_item -> 'slip'), 'queueLeft', v_n) || (p_item - 'slip');
    insert into public.line_sessions(line_user_id, state, payload, expires_at, updated_at)
    values (p_line_user, 'exp_amount', v_cur, now() + make_interval(secs => p_ttl_sec), now())
    on conflict (line_user_id) do update
      set state = excluded.state, payload = excluded.payload,
          expires_at = excluded.expires_at, updated_at = now();
    return jsonb_build_object('role', 'current', 'queued', v_n, 'photos', 1);
  end if;

  v_pics := coalesce(r.payload -> 'slips', '[]'::jsonb);

  -- กดเมนูคีย์รายจ่ายไว้ / ส่งรูปที่อ่านไม่ได้ไว้ก่อน (ยังไม่มียอดจาก AI) → สลิปนี้เติมใบปัจจุบัน
  if r.state = 'exp_amount' and not (r.payload ? 'aiAmount') and jsonb_array_length(v_pics) < p_max_photos then
    v_pics := v_pics || jsonb_build_array(p_item -> 'slip');
    update public.line_sessions
       set payload = r.payload || (p_item - 'slip') || jsonb_build_object('slips', v_pics, 'queueLeft', v_n),
           expires_at = now() + make_interval(secs => p_ttl_sec), updated_at = now()
     where line_user_id = p_line_user;
    return jsonb_build_object('role', 'current', 'queued', v_n, 'photos', jsonb_array_length(v_pics));
  end if;

  -- เลขอ้างอิงเดียวกับใบปัจจุบัน = รูปอีกมุมของใบเดิม → แนบรูปเพิ่ม ไม่ใช่รายการใหม่
  if nullif(p_item ->> 'aiRef', '') is not null and r.payload ->> 'aiRef' = p_item ->> 'aiRef' then
    if jsonb_array_length(v_pics) >= p_max_photos then
      return jsonb_build_object('role', 'full_photos', 'queued', v_n);
    end if;
    v_pics := v_pics || jsonb_build_array(p_item -> 'slip');
    update public.line_sessions
       set payload = jsonb_set(payload, array['slips'], v_pics),
           expires_at = now() + make_interval(secs => p_ttl_sec), updated_at = now()
     where line_user_id = p_line_user;
    return jsonb_build_object('role', 'attached', 'queued', v_n, 'photos', jsonb_array_length(v_pics));
  end if;

  if v_n >= p_max then
    return jsonb_build_object('role', 'full', 'queued', v_n);
  end if;
  insert into public.line_slip_queue(line_user_id, item) values (p_line_user, p_item);
  return jsonb_build_object('role', 'queued', 'queued', v_n + 1, 'position', v_n + 1);
end $$;

-- ดึงสลิปใบถัดไปขึ้นเป็นใบปัจจุบัน · null = คิวว่าง (ผู้เรียกจัดการเซสชันเอง)
create or replace function public.bot_slip_next(p_line_user text, p_ttl_sec int default 1800)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   bigint;
  v_item jsonb;
  v_n    int;
  v_cur  jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('line_photo:' || p_line_user));
  delete from public.line_slip_queue
   where line_user_id = p_line_user and created_at < now() - interval '24 hours';
  select id, item into v_id, v_item from public.line_slip_queue
   where line_user_id = p_line_user order by id limit 1;
  if v_id is null then
    return null;
  end if;
  delete from public.line_slip_queue where id = v_id;
  select count(*) into v_n from public.line_slip_queue where line_user_id = p_line_user;
  v_cur := jsonb_build_object('slips', jsonb_build_array(v_item -> 'slip'), 'queueLeft', v_n) || (v_item - 'slip');
  insert into public.line_sessions(line_user_id, state, payload, expires_at, updated_at)
  values (p_line_user, 'exp_amount', v_cur, now() + make_interval(secs => p_ttl_sec), now())
  on conflict (line_user_id) do update
    set state = excluded.state, payload = excluded.payload,
        expires_at = excluded.expires_at, updated_at = now();
  return jsonb_build_object('payload', v_cur, 'left', v_n);
end $$;

-- พิมพ์ "ยกเลิก" = ทิ้งคิวทั้งหมด · คืนจำนวนที่ทิ้ง
create or replace function public.bot_slip_clear(p_line_user text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('line_photo:' || p_line_user));
  delete from public.line_slip_queue where line_user_id = p_line_user;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.bot_slip_take(text, jsonb, int, int, int) from public, anon, authenticated;
revoke execute on function public.bot_slip_next(text, int) from public, anon, authenticated;
revoke execute on function public.bot_slip_clear(text) from public, anon, authenticated;
grant  execute on function public.bot_slip_take(text, jsonb, int, int, int) to service_role;
grant  execute on function public.bot_slip_next(text, int) to service_role;
grant  execute on function public.bot_slip_clear(text) to service_role;
