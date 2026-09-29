-- แก้ set_line_keys: text[] || 'literal' ถูกอ่านเป็น array literal → ใช้ array_append
-- (ฐานที่ apply 20260929100000 ไปก่อนแก้ต้องรันไฟล์นี้; ฐานใหม่ได้ฟังก์ชันถูกอยู่แล้ว)
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
