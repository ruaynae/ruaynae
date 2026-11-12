-- ════════════════════════════════════════════════════════════════════════
-- R41 · ระบบตรวจบิล (คำขอเจ้าของ 11–12 พ.ย. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- "จ่ายเงินไปแล้ว ได้บิลกลับมาหรือยัง" — สลิปโอน (หลักฐานว่าจ่าย) อยู่ที่ `attachments` ของรายจ่ายเหมือนเดิม
-- บิล/ใบเสร็จ/ใบกำกับภาษี (หลักฐานจากผู้ขาย · ส่งสำนักงานบัญชียื่นสรรพากร) เก็บแยกที่ `bills` แล้วผูกกับรายจ่ายผ่าน `bill_matches`
--
-- · หนึ่งแถว `bills` = บิลหนึ่งใบ = รูปหนึ่งรูปใน R2 (`bills/…`) — PDF ที่สแกนทีละปึกถูกแยกเป็นรูปทีละหน้าที่เบราว์เซอร์ก่อนอัป
-- · `bill_matches` เป็นแบบหลายต่อหลาย: โอนครั้งเดียวจ่ายหลายบิล (หลายบิล → รายจ่ายใบเดียว) · บิลเดียวจ่ายหลายครั้ง (มัดจำ + ส่วนที่เหลือ)
-- · รายจ่ายที่ "ไม่ต้องมีบิล": หมวดที่ `categories.bill_required = false` (ค่าแรง เบี้ยเลี้ยง …) หรือรายใบ `transactions.bill_not_required`
-- · เริ่มตรวจตั้งแต่ `app_settings.bill_check_from` (เจ้าของเลือก "เริ่มจากเดือนนี้" = 1 พ.ย. 2569) — รายจ่ายก่อนหน้านั้นไม่นับว่าค้างบิล
--
-- 🔴 เจ้าของเท่านั้นทั้งสองตาราง (ข้อมูลเงิน/ภาษีของบริษัท) · audit ทุกตาราง · ไม่มีข้อมูลตั้งต้นของลูกค้าในไฟล์นี้

create table if not exists public.bills (
  id             uuid primary key default gen_random_uuid(),
  object_key     text not null unique check (object_key like 'bills/%'),
  content_type   text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size      int  not null check (byte_size > 0),
  file_name      text not null default '' check (length(file_name) <= 300),
  page_no        int  check (page_no is null or page_no between 1 and 999),
  source         text not null default 'web' check (source in ('web', 'line')),
  vendor         text check (vendor is null or length(vendor) <= 200),
  vendor_tax_id  text check (vendor_tax_id is null or vendor_tax_id ~ '^[0-9]{13}$'),
  bill_no        text check (bill_no is null or length(bill_no) <= 60),
  bill_date      date,
  amount         numeric(14,2) check (amount is null or amount > 0),
  vat_amount     numeric(14,2) check (vat_amount is null or vat_amount >= 0),
  -- pending = รอ AI อ่าน · read = อ่านแล้ว · failed = อ่านไม่ได้ (กรอกเอง) · manual = เจ้าของแก้เอง
  read_status    text not null default 'pending' check (read_status in ('pending', 'read', 'failed', 'manual')),
  -- ข้ามบิลนี้ (ไม่ใช่บิลค่าใช้จ่าย/ซ้ำ) — ไม่ขึ้นในกองที่ต้องจับคู่
  ignored        boolean not null default false,
  note           text not null default '' check (length(note) <= 500),
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists bills_created_idx on public.bills(created_at desc, id desc);
create index if not exists bills_amount_idx on public.bills(amount);
create index if not exists bills_created_by_idx on public.bills(created_by);

create table if not exists public.bill_matches (
  bill_id        uuid not null references public.bills(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  matched_by     text not null check (matched_by in ('auto', 'manual')),
  created_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  primary key (bill_id, transaction_id)
);
create index if not exists bill_matches_txn_idx on public.bill_matches(transaction_id);
create index if not exists bill_matches_created_by_idx on public.bill_matches(created_by);

-- ── ไม่ต้องมีบิล: รายหมวด + รายใบ ─────────────────────────────────────────
alter table public.categories add column if not exists bill_required boolean not null default true;
-- หมวดที่ไม่มีบิลจากผู้ขายตามธรรมชาติ (เจ้าของตอบ: ค่าแรง เบี้ยเลี้ยง "น่าจะมีแค่นี้") — แก้ได้ภายหลังที่ตาราง categories
update public.categories set bill_required = false
  where kind = 'expense' and bill_required and (name ilike '%ค่าแรง%' or name ilike '%เบี้ยเลี้ยง%' or name ilike '%โบนัส%');

alter table public.transactions add column if not exists bill_not_required boolean not null default false;

-- ── เริ่มตรวจตั้งแต่ ────────────────────────────────────────────────────────
alter table public.app_settings add column if not exists bill_check_from date not null default date '2026-11-01';

-- ── RLS + audit — เจ้าของเท่านั้น ────────────────────────────────────────────
alter table public.bills enable row level security;
alter table public.bill_matches enable row level security;

drop policy if exists bills_owner_all on public.bills;
create policy bills_owner_all on public.bills for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists bill_matches_owner_all on public.bill_matches;
create policy bill_matches_owner_all on public.bill_matches for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

drop trigger if exists bills_audit on public.bills;
create trigger bills_audit after insert or update or delete on public.bills
  for each row execute function public.audit_row();
drop trigger if exists bill_matches_audit on public.bill_matches;
create trigger bill_matches_audit after insert or update or delete on public.bill_matches
  for each row execute function public.audit_row();
drop trigger if exists bills_set_updated_at on public.bills;
create trigger bills_set_updated_at before update on public.bills
  for each row execute function public.set_updated_at();

comment on table public.bills is 'R41 · บิล/ใบเสร็จ/ใบกำกับภาษีจากผู้ขาย (รูปละหนึ่งใบใน R2 bills/…) — เจ้าของเท่านั้น';
comment on table public.bill_matches is 'R41 · บิล ↔ รายจ่าย (หลายต่อหลาย) — auto = ระบบจับคู่ให้ · manual = เจ้าของเลือก';

-- ตรวจหลังรัน:
--   select to_regclass('public.bills'), to_regclass('public.bill_matches');
--   select name, bill_required from public.categories where kind = 'expense' order by sort_order;
