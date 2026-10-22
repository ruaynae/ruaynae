-- ════════════════════════════════════════════════════════════════════════
-- รูปแนบท้ายหนังสือบริษัท — เก็บไว้กับหนังสือในทะเบียน (คำขอเจ้าของ 23 ต.ค. 2569)
-- ════════════════════════════════════════════════════════════════════════
--
-- เดิม (R19 · D9) รูปแนบอยู่แค่ในเบราว์เซอร์ ปิดหน้าแล้วหาย · ตอนนี้เก็บไฟล์ใน R2 (`letters/<uuid>.jpg`)
-- แล้วผูกกับหนังสือทีละแถว เรียงตาม `seq` · หัวข้อหน้ารูปแนบ/การจัดวางอยู่บน `letters`
-- · อัปผ่าน `upload_intents` เดิม (thumb_key = object_key) → ไฟล์ที่อัปแล้วไม่ได้บันทึกถูก sweep-orphans กวาด
-- · ลบหนังสือ = ลบแถวรูปตาม (cascade) · ไฟล์ใน R2 ลบโดย API ตอนลบหนังสือ
-- · เจ้าของเท่านั้นเหมือนตาราง `letters`

alter table public.letters
  add column if not exists photo_title  text not null default '' check (length(photo_title) <= 200),
  add column if not exists photo_layout text not null default '1' check (photo_layout in ('1', '2'));

create table if not exists public.letter_photos (
  id          uuid primary key default gen_random_uuid(),
  letter_id   uuid not null references public.letters(id) on delete cascade,
  seq         int  not null check (seq between 1 and 12),
  object_key  text not null unique check (object_key like 'letters/%'),
  caption     text not null default '' check (length(caption) <= 200),
  byte_size   int  not null default 0 check (byte_size >= 0),
  created_at  timestamptz not null default now(),
  constraint letter_photos_seq_uniq unique (letter_id, seq)
);
create index if not exists letter_photos_letter_idx on public.letter_photos(letter_id, seq);

alter table public.letter_photos enable row level security;

drop policy if exists letter_photos_owner_select on public.letter_photos;
create policy letter_photos_owner_select on public.letter_photos for select to authenticated
  using ((select public.is_owner()));
drop policy if exists letter_photos_owner_insert on public.letter_photos;
create policy letter_photos_owner_insert on public.letter_photos for insert to authenticated
  with check ((select public.is_owner()));
drop policy if exists letter_photos_owner_update on public.letter_photos;
create policy letter_photos_owner_update on public.letter_photos for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
drop policy if exists letter_photos_owner_delete on public.letter_photos;
create policy letter_photos_owner_delete on public.letter_photos for delete to authenticated
  using ((select public.is_owner()));

drop trigger if exists letter_photos_audit on public.letter_photos;
create trigger letter_photos_audit after insert or update or delete on public.letter_photos
  for each row execute function public.audit_row();

comment on table public.letter_photos is
  'รูปแนบท้ายหนังสือบริษัท (ไฟล์อยู่ R2 letters/…) เรียงตาม seq · เจ้าของเท่านั้น';
