-- R16 · ผูก LINE ได้หลายบัญชีต่อเจ้าของ (คำขอเจ้าของ 30 ก.ย. 2569 · แบบเดียวกับระบบหวย)
-- เดิม profile_id unique = ผูกใหม่แทนของเดิม · ตอนนี้ LINE หนึ่งบัญชียังผูกได้กับเจ้าของคนเดียว
-- แต่เจ้าของหนึ่งคนมี LINE ได้หลายบัญชี · เลิกผูกทีละบัญชีด้วย id

alter table public.line_accounts drop constraint if exists line_accounts_profile_id_key;
create index if not exists line_accounts_profile_idx on public.line_accounts (profile_id);

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

  -- ผูก LINE เดิมซ้ำ = ย้ายไปเจ้าของที่ออกรหัส · บัญชี LINE อื่นของเจ้าของคนนี้ไม่ถูกแตะ
  delete from public.line_accounts where line_user_id = p_line_user;
  insert into public.line_accounts(line_user_id, profile_id, display_name)
  values (p_line_user, v_profile, nullif(btrim(coalesce(p_display, '')), ''));
  update public.line_link_codes set used_at = now() where id = v_code_id;
  delete from public.line_link_failures where line_user_id = p_line_user;
  return jsonb_build_object('ok', true, 'name', v_name);
end $$;
revoke execute on function public.bot_link(text, text, text) from public, anon, authenticated;
grant  execute on function public.bot_link(text, text, text) to service_role;

drop function if exists public.unlink_line_account();
create or replace function public.unlink_line_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  delete from public.line_accounts where id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;
revoke execute on function public.unlink_line_account(uuid) from public, anon;
grant  execute on function public.unlink_line_account(uuid) to authenticated;
