-- อ่านสลิปด้วย AI ในบอท LINE (31 ต.ค. 2569) — คีย์ Gemini API เก็บใน Vault เหมือนคีย์ LINE/Loyverse
--
-- 🔴 คีย์ไม่ถูกส่งกลับเป็นข้อความจริงที่ไหนเลย — หน้าตั้งค่าเห็นแค่ 4 ตัวท้าย
-- 🔴 ตัวอ่านคีย์จริง (`_slip_ai_key`) ให้เฉพาะ service_role · มีคีย์ = เปิดใช้ · ลบคีย์ = ปิด
-- ไม่มีตารางใหม่ · ไม่แตะข้อมูลเดิม · รันซ้ำได้

create or replace function public.set_slip_ai_key(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
  v_id  uuid;
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select id into v_id from vault.secrets where name = 'slip_ai_gemini_key';

  if v_key is null then
    -- ช่องว่าง = ปิดการอ่านสลิป · ทับค่าด้วยสตริงว่าง (ไม่ลบแถวใน vault ตรง ๆ — สิทธิ์ลบไม่แน่นอนข้ามรุ่น)
    if v_id is not null then
      perform vault.update_secret(v_id, '');
    end if;
  else
    if length(v_key) not between 20 and 200 or v_key ~ '\s' then
      raise exception 'slip_ai_key_invalid';
    end if;
    if v_id is null then
      perform vault.create_secret(v_key, 'slip_ai_gemini_key', 'Gemini API key สำหรับอ่านสลิปในบอท LINE');
    else
      perform vault.update_secret(v_id, v_key);
    end if;
  end if;

  -- ร่องรอยว่าใครเปลี่ยนคีย์ตอนไหน · ไม่มีค่าคีย์เด็ดขาด
  insert into public.audit_log(table_name, row_id, action, actor, before, after)
  values ('slip_ai_key', null, 'UPDATE', auth.uid(), null,
          jsonb_build_object('set', v_key is not null));
end $$;
revoke execute on function public.set_slip_ai_key(text) from public, anon;
grant  execute on function public.set_slip_ai_key(text) to authenticated;

create or replace function public.slip_ai_key_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v text;
begin
  if not public.is_owner() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select nullif(decrypted_secret, '') into v from vault.decrypted_secrets where name = 'slip_ai_gemini_key';
  return jsonb_build_object('set', v is not null, 'last4', case when v is null then null else right(v, 4) end);
end $$;
revoke execute on function public.slip_ai_key_status() from public, anon;
grant  execute on function public.slip_ai_key_status() to authenticated;

-- ตัวอ่านคีย์จริง — เฉพาะเซิร์ฟเวอร์ (service_role) · ห้ามให้ authenticated เด็ดขาด
create or replace function public._slip_ai_key()
returns text
language sql
security definer
set search_path = ''
as $$
  select nullif(decrypted_secret, '') from vault.decrypted_secrets where name = 'slip_ai_gemini_key'
$$;
revoke execute on function public._slip_ai_key() from public, anon, authenticated;
grant  execute on function public._slip_ai_key() to service_role;
