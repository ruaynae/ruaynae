-- R18 · M1 ไฟล์ที่ 1/2 — ค่า enum ใหม่ (ต้องรันแยกก่อนไฟล์ที่ 2)
--
-- 🔴 Postgres ห้ามใช้ค่า enum ที่เพิ่งเพิ่มในทรานแซกชันเดียวกับที่เพิ่ม
--    (`unsafe use of new value`) · SQL Editor ของ Supabase รันทั้งไฟล์เป็นก้อนเดียว
--    จึงต้องรันไฟล์นี้ให้จบก่อน แล้วค่อยรัน `20261019090100_r18_material_requests.sql`

-- แคชเชียร์ร้านวัสดุ (เจ้าของเลือก 19 ต.ค. 2569: บทบาทใหม่ ล็อกอินด้วย PIN)
-- เห็นแค่ใบขอเบิกรอจ่าย · ไม่เห็นเงินของบริษัท
alter type public.user_role add value if not exists 'cashier';

-- แจ้งเตือนแคชเชียร์เมื่อมีใบขอเบิกใหม่
alter type public.notification_kind add value if not exists 'material_request';
