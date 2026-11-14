-- LINE bot · เมนูคีย์รายจ่าย: รายการโครงการรวมโครงการที่ส่งมอบแล้ว/หยุดชั่วคราว (เจ้าของแจ้ง 14 พ.ย. 2569)
-- เดิมมีแค่ planning/active → โครงการที่ส่งงานแล้วไม่ขึ้นให้เลือก แต่ยังมีรายจ่ายตามหลังได้ (เว็บเลือกได้อยู่แล้ว)
-- เรียงโครงการที่ยังทำอยู่ก่อน แล้วค่อยหยุด/ส่งมอบแล้ว · ไม่รวม cancelled
create or replace function public.bot_expense_options(p_line_user text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._bot_as(p_line_user);
  return jsonb_build_object(
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name)
                     order by c.sort_order, c.name), '[]'::jsonb)
                     from public.categories c where c.kind = 'expense' and c.is_active),
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name)
                     order by (s.status in ('planning', 'active')) desc, s.name), '[]'::jsonb)
                     from public.sites s where s.status in ('planning', 'active', 'paused', 'done')),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name)
                     order by e.full_name), '[]'::jsonb)
                     from public.employees e where e.is_active));
end $$;
