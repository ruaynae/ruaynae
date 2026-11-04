-- หัวข้อบนหน้าของรูปแนบแต่ละรูป (คำขอเจ้าของ 4 พ.ย. 2569)
-- แบบ "1 รูปต่อ 1 หน้า" (แค็ตตาล็อก) เดิมมีหัวข้อรวมช่องเดียวขึ้นเฉพาะหน้าแรก
-- → เพิ่มหัวข้อต่อรูป เช่น "ลามิเนตปิดผิว Formica D8202" · ว่าง = ใช้พฤติกรรมเดิม
alter table public.letter_photos
  add column if not exists heading text not null default '' check (length(heading) <= 200);
