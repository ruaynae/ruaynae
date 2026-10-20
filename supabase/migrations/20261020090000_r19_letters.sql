-- ════════════════════════════════════════════════════════════════════════
-- R19 · หนังสือบริษัท + ทะเบียนหนังสือส่ง
-- ════════════════════════════════════════════════════════════════════════
--
-- ถอดจากหนังสือจริงของห้าง 42 ฉบับ (`reg001`–`reg047/2569`) — ดู
-- `docs/test-plan/R19-letters.md` หมวด 0 สำหรับสิ่งที่ตัดสินใจไว้
--
-- 🔴 ไม่มีข้อมูลตั้งต้นในไฟล์นี้ (ทั้งชุดเลขและหนังสือเก่า) — repo เป็น public
--    ข้อความหนังสือของลูกค้าเข้ามาทางปุ่ม "นำเข้าไฟล์สำรอง" ในหน้า `/letters`
--
-- 🔴 เลขที่หนังสือนับ **ต่อชุดเลข ต่อปี** — `reg001/2569` กับ `reg001/2570`
--    เป็นคนละฉบับ · ปีเก็บเป็น ค.ศ. (`year_ce`) ตามกติกา §15 แสดงผลเป็น พ.ศ.

-- ── 1 · ชุดเลขหนังสือ (หนึ่งชุดต่อโครงการที่ออกหนังสือ) ─────────────────
create table if not exists public.letter_series (
  id           uuid primary key default gen_random_uuid(),
  label        text not null check (length(btrim(label)) between 1 and 80),
  -- คำนำหน้าเลขที่ เช่น `reg` → `reg048/2569` · ห้ามมีช่องว่างและ `/`
  -- เพราะ `/` คือตัวคั่นปีบนกระดาษ
  prefix       text not null check (prefix ~ '^[^\s/]{1,12}$'),
  -- ผูกกับโครงการได้ ไม่บังคับ · ลบโครงการแล้วชุดเลขกับหนังสือต้องอยู่ต่อ
  site_id      uuid references public.sites(id) on delete set null,
  -- ค่าตั้งต้นที่ฟอร์มเติมให้ทุกฉบับของชุดนี้ (แก้รายฉบับได้)
  recipient    text not null default '' check (length(recipient) <= 300),
  contract_ref text not null default '' check (length(contract_ref) <= 300),
  -- ย่อหน้า "ข้าพเจ้า … ตามหนังสือที่อ้างถึง (1)" · `{บริษัท}` = ชื่อห้างจาก branding
  intro        text not null default '' check (length(intro) <= 2000),
  -- ตำแหน่งใต้ชื่อผู้ลงนาม เช่น "ผู้รับจ้าง"
  signer_title text not null default '' check (length(signer_title) <= 80),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists letter_series_prefix_uniq on public.letter_series(lower(prefix));
create index if not exists letter_series_site_idx on public.letter_series(site_id);

-- ── 2 · หนังสือ ──────────────────────────────────────────────────────
create table if not exists public.letters (
  id           uuid primary key default gen_random_uuid(),
  -- 🔴 restrict ไม่ใช่ cascade — ลบชุดเลขแล้วทะเบียนหนังสือหายทั้งเล่ม = ประวัติที่กู้ไม่ได้
  series_id    uuid not null references public.letter_series(id) on delete restrict,
  seq          int  not null check (seq between 1 and 99999),
  letter_date  date not null,
  year_ce      int  generated always as (extract(year from letter_date)::int) stored,
  subject      text not null check (length(btrim(subject)) between 1 and 300),
  recipient    text not null check (length(btrim(recipient)) between 1 and 300),
  -- รายการ "อ้างถึง" ทั้งหมด (รวมสัญญาข้อ 1) และ "สิ่งที่ส่งมาด้วย" — ไม่มีเลขข้อ
  -- กระดาษใส่ 1. 2. ให้เอง
  refs         text[] not null default '{}' check (cardinality(refs) <= 10),
  attachments  text[] not null default '{}' check (cardinality(attachments) <= 10),
  -- 1 บรรทัด = 1 ย่อหน้า · บรรทัดที่ขึ้นต้นด้วย "1." "-" = ข้อย่อย
  body         text not null default '' check (length(body) <= 8000),
  closing      text not null default '' check (length(closing) <= 300),
  -- ย่อหน้าแนะนำโครงการ **ที่เติมชื่อห้างแล้ว** · null = ฉบับนี้ไม่ใส่
  intro        text check (intro is null or length(intro) <= 2000),
  signer_title text not null default '' check (length(signer_title) <= 80),
  show_receipt boolean not null default true,
  -- แบบที่ใช้สร้าง + ค่าช่องด่วน — ให้ "ทำซ้ำ" นับ "ครั้งที่" ต่อได้
  template_id  text check (template_id is null or length(template_id) <= 40),
  fields       jsonb not null default '{}'::jsonb,
  -- 🔴 สำเนาหัวกระดาษ ณ วันที่บันทึก (ชื่อห้าง · ที่อยู่ · ผู้ลงนาม)
  --    เหตุผลเดียวกับ `documents.seller`: ฉบับที่ส่งไปแล้วต้องพิมพ์ซ้ำออกมาเหมือนเดิม
  letterhead   jsonb not null default '{}'::jsonb,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- เลขห้ามซ้ำในชุดเดียวกันปีเดียวกัน · API แปล `23505` เป็น `LETTER_NO_TAKEN`
  constraint letters_no_uniq unique (series_id, year_ce, seq)
);
-- ลิสต์ทะเบียน: keyset ด้วย (letter_date desc, id desc) ต่อชุดเลข (§7)
create index if not exists letters_series_date_idx on public.letters(series_id, letter_date desc, id desc);
create index if not exists letters_date_idx on public.letters(letter_date desc, id desc);
create index if not exists letters_created_by_idx on public.letters(created_by);

-- ── 3 · RLS + audit — เจ้าของเท่านั้นทั้งสองตาราง ────────────────────────
-- หนังสือออกในนามห้างและลงชื่อผู้ลงนาม จึงเป็นของเจ้าของเหมือน `documents`
alter table public.letter_series enable row level security;
alter table public.letters       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['letter_series', 'letters'] loop
    execute format('drop policy if exists %I_owner_select on public.%I', t, t);
    execute format('create policy %I_owner_select on public.%I for select to authenticated
                      using ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_insert on public.%I', t, t);
    execute format('create policy %I_owner_insert on public.%I for insert to authenticated
                      with check ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_update on public.%I', t, t);
    execute format('create policy %I_owner_update on public.%I for update to authenticated
                      using ((select public.is_owner())) with check ((select public.is_owner()))', t, t);
    execute format('drop policy if exists %I_owner_delete on public.%I', t, t);
    execute format('create policy %I_owner_delete on public.%I for delete to authenticated
                      using ((select public.is_owner()))', t, t);

    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                      for each row execute function public.audit_row()', t, t);

    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format('create trigger %I_set_updated_at before update on public.%I
                      for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

comment on table public.letter_series is
  'R19 · ชุดเลขหนังสือบริษัท (หนึ่งชุดต่อโครงการ) — คำนำหน้า เรียน สัญญา ย่อหน้าแนะนำ ตำแหน่งผู้ลงนาม';
comment on table public.letters is
  'R19 · ทะเบียนหนังสือส่ง — เลขที่ = prefix + seq(3 หลัก) + "/" + (year_ce + 543)';
