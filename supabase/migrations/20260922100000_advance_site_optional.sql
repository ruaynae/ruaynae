-- ════════════════════════════════════════════════════════════════════════
-- คำขอเบิกของหัวหน้าโครงการ **ไม่ต้องผูกโครงการ** (คำสั่งเจ้าของ 22 ก.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เจ้าของแจ้งจากการใช้จริง: *"เมื่อหัวหน้างานเบิกเงิน มันให้เลือกโครงการ ทั้ง ๆ ที่
-- ถ้าเจ้าของเบิกเองมันไม่มีให้เลือก เพราะมันเป็นรายรับรวมของช่างที่ทำงานอยู่แล้ว"*
--
-- 🔴 เหตุผลเชิงโมเดล: **ค่าแรงเป็นของคน ไม่ใช่ของโครงการ** — คนหนึ่งคนเข้าหลาย
-- โครงการในสัปดาห์เดียวได้ และยอดค้างจ่ายของเขาเป็นก้อนเดียวไม่แยกตามโครงการ
-- (`employee_balance` / `payroll_balances` ไม่เคยมีมิติโครงการเลยตั้งแต่ P5)
-- · การบังคับให้เลือกโครงการตอนยื่นคำขอจึงเป็นการถามคำถามที่ระบบไม่ได้ใช้คำตอบ
-- และหัวหน้าโครงการต้องเดาว่าจะลงโครงการไหนทั้งที่เงินก้อนนี้ไม่ได้เข้าต้นทุน
-- โครงการใดเลย (เบิก = เงินสดออก ไม่ใช่ต้นทุน — กับดักข้อ 1 ของโปรเจ็ค)
--
-- ⚠️ ขอบเขตของหัวหน้าโครงการจึงไม่ได้ผูกกับ `site_id` อีกต่อไป แต่ผูกกับ
-- **"ใบที่ตัวเองยื่น"** (`created_by = auth.uid()`) ซึ่งเป็นขอบเขตที่ policy
-- select/delete ใช้อยู่แล้วตั้งแต่ R14 · ที่ยังบังคับเหมือนเดิม: ถ้า**เลือก**
-- โครงการมา ต้องเป็นโครงการที่ตัวเองดูแลจริง (กันการยิง API ใส่โครงการคนอื่น)

-- ── 1 · policy: site_id เป็นตัวเลือก ไม่ใช่เงื่อนไขของสิทธิ์ ─────────
drop policy if exists advances_insert on public.advances;
create policy advances_insert on public.advances
  for insert to authenticated with check (
    (select public.is_owner())
    or (created_by = (select auth.uid())
        and (site_id is null or public.supervises_site(site_id)))
  );

-- ⚠️ `using` ของ update ต้องไม่มี `site_id is not null` อีกแล้ว ไม่งั้นใบที่ไม่ผูก
-- โครงการจะถูกตัดออกตั้งแต่ด่านแรก → เจ้าตัวแก้คำขอของตัวเองไม่ได้เลย และ
-- PostgREST จะตอบ 200 พร้อม 0 แถว (อาการเดียวกับ §17 ข้อ 18 เป๊ะ)
-- 🔴 และ `with check` ยังห้ามมีเงื่อนไขสถานะเหมือนเดิม — ไม่งั้น guard trigger
-- จะไม่มีโอกาสได้อธิบายว่าทำไมถึงไม่ได้
drop policy if exists advances_update on public.advances;
create policy advances_update on public.advances
  for update to authenticated
  using (
    (select public.is_owner())
    or (created_by = (select auth.uid()) and status in ('pending', 'rejected'))
  )
  with check (
    (select public.is_owner())
    or (created_by = (select auth.uid())
        and (site_id is null or public.supervises_site(site_id)))
  );

-- ── 2 · guard: เลิกบังคับ SITE_REQUIRED ──────────────────────────────
-- ต่อจาก `20260922090000_advance_owner_insert_approved.sql` · เปลี่ยนข้อเดียว
-- คือถอดการบังคับโครงการออก · กฎอื่นอยู่ครบทุกข้อ (สถานะตาม role · วันอนาคต ·
-- ใบที่ถูกหักคืนแล้วแตะไม่ได้ · created_by ทับไม่ได้)
create or replace function public.guard_advance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner boolean := public.is_owner();
  v_service  boolean := auth.uid() is null;
  v_locked   boolean;
begin
  if new.advance_date > (now() at time zone 'Asia/Bangkok')::date then
    raise exception 'DATE_FUTURE: บันทึกเบิกของวันในอนาคตไม่ได้';
  end if;

  if tg_op = 'INSERT' then
    if not v_service then new.created_by := auth.uid(); end if;

    if not v_is_owner and not v_service then
      -- 🔴 ไม่บังคับโครงการอีกแล้ว (22 ก.ย. 2569) — ค่าแรงเป็นของคน ไม่ใช่ของโครงการ
      -- · ที่ยังบังคับคือสถานะ: หัวหน้าโครงการยื่นได้เฉพาะ "คำขอ" เท่านั้น
      if new.status <> 'pending' then
        raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการตั้งสถานะเองไม่ได้';
      end if;
      if new.payroll_run_id is not null or new.deducted_amount <> 0 then
        raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการตั้งยอดที่หักแล้วเองไม่ได้';
      end if;
    end if;

    -- เจ้าของคีย์เอง = เงินออกจากมือไปแล้ว (20260922090000)
    if v_is_owner then new.status := 'approved'; end if;

    if new.status = 'approved' and not v_service then
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
    if new.status <> 'rejected' then new.rejected_reason := null; end if;
    return new;
  end if;

  -- ── UPDATE ─────────────────────────────────────────────────────────
  new.created_by := old.created_by;
  v_locked := old.payroll_run_id is not null or old.deducted_amount > 0;

  if not v_is_owner and not v_service then
    if old.status = 'rejected' then
      new.status := 'pending';
      new.rejected_reason := null;
      new.approved_by := null;
      new.approved_at := null;
    elsif new.status is distinct from old.status then
      raise exception 'APPROVE_FORBIDDEN: หัวหน้าโครงการเปลี่ยนสถานะไม่ได้';
    end if;
  end if;

  if v_locked then
    if new.amount is distinct from old.amount then
      raise exception 'PAYROLL_CLOSED: ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว แก้ยอดไม่ได้';
    end if;
    if new.status is distinct from old.status then
      raise exception 'PAYROLL_CLOSED: ใบเบิกนี้ถูกหักตอนจ่ายค่าแรงไปแล้ว เปลี่ยนสถานะไม่ได้';
    end if;
  end if;

  if new.deducted_amount > new.amount then
    raise exception 'ADVANCE_DEDUCTED_EXCEEDS: ยอดที่หักคืนแล้วมากกว่ายอดในใบเบิก';
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := auth.uid();
    new.approved_at := now();
  elsif new.status <> 'approved' and old.status = 'approved' then
    new.approved_by := null;
    new.approved_at := null;
  end if;
  if new.status <> 'rejected' then new.rejected_reason := null; end if;

  return new;
end $$;

revoke execute on function public.guard_advance() from public, anon, authenticated;
