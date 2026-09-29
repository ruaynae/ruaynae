-- R16 · รูปบิลหลายรูปที่เข้ามาพร้อมกันจากหลาย webhook
--
-- bot_session_append ต้องมีเซสชันอยู่แล้ว · ถ้าสองรูปแรกมาพร้อมกันตอนยังไม่มีเซสชัน
-- ทั้งสองอ่านเจอ "ว่าง" แล้วต่างคนต่างสร้างเซสชันใหม่ทับกัน = รูปแรกหาย ไม่มี error
-- ฟังก์ชันนี้ล็อกต่อผู้ใช้ (advisory lock) แล้ว "สร้างถ้ายังไม่มี / ต่อถ้ามีแล้ว" ในก้อนเดียว

create or replace function public.bot_session_photo(
  p_line_user text, p_slip jsonb, p_max int default 4, p_ttl_sec int default 1800)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   public.line_sessions%rowtype;
  arr jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('line_photo:' || p_line_user));

  select * into r from public.line_sessions
   where line_user_id = p_line_user and expires_at > now();

  if not found or r.state not in ('exp_amount', 'exp_cat', 'exp_site', 'exp_confirm') then
    insert into public.line_sessions(line_user_id, state, payload, expires_at, updated_at)
    values (p_line_user, 'exp_amount', jsonb_build_object('slips', jsonb_build_array(p_slip)),
            now() + make_interval(secs => p_ttl_sec), now())
    on conflict (line_user_id) do update
      set state = excluded.state, payload = excluded.payload,
          expires_at = excluded.expires_at, updated_at = now();
    return jsonb_build_object('state', 'exp_amount', 'count', 1, 'full', false, 'started', true);
  end if;

  arr := coalesce(r.payload -> 'slips', '[]'::jsonb);
  if jsonb_array_length(arr) >= p_max then
    return jsonb_build_object('state', r.state, 'count', jsonb_array_length(arr),
                              'full', true, 'started', false);
  end if;
  arr := arr || jsonb_build_array(p_slip);
  update public.line_sessions
     set payload = jsonb_set(payload, array['slips'], arr),
         expires_at = now() + make_interval(secs => p_ttl_sec), updated_at = now()
   where line_user_id = p_line_user;
  return jsonb_build_object('state', r.state, 'count', jsonb_array_length(arr),
                            'full', false, 'started', false);
end $$;

revoke execute on function public.bot_session_photo(text, jsonb, int, int)
  from public, anon, authenticated;
grant execute on function public.bot_session_photo(text, jsonb, int, int) to service_role;
