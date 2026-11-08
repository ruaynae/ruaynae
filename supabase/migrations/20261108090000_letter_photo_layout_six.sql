-- ════════════════════════════════════════════════════════════════════════
-- หน้ารูปแนบหนังสือ: เพิ่มการจัดวาง '6' = 6 รูปต่อหน้า (2 คอลัมน์ × 3 แถว · คำขอเจ้าของ 8 พ.ย. 2569)
-- ยังไม่รัน = เลือก "6 รูปต่อหน้า" แล้วพิมพ์/ดาวน์โหลดได้ตามปกติ แต่เปิดหนังสือใหม่แล้วการจัดวางจะกลับเป็นค่าเดิม
-- ════════════════════════════════════════════════════════════════════════
do $$
declare r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.letters'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ~ 'photo_layout'
  loop
    execute format('alter table public.letters drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.letters add constraint letters_photo_layout_check check (photo_layout in ('1', '2', '6', 'p'));
