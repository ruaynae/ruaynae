-- R18 · M1 ไฟล์ที่ 2/2 — ใบขอเบิกวัสดุ + บทบาทแคชเชียร์
-- 🔴 รันหลัง `20261019090000_r18_cashier_role.sql` จบแล้วเท่านั้น (ค่า enum ใหม่ใช้ในทรานแซกชันเดียวกันไม่ได้)
-- แผน: docs/test-plan/R18-loyverse-withdrawals.md
--
-- หลักคิด
-- · หัวหน้าโครงการ (หรือเจ้าของ) คีย์ใบขอเบิกแทนช่าง → แท็บเล็ตแคชเชียร์เห็น → แคชเชียร์กด "จ่ายของแล้ว"
-- · ตาราง **ไม่มี policy เขียนให้ใครเลย** และอ่านตรงได้เฉพาะเจ้าของ — ทุกทางผ่าน RPC `security definer`
--   ที่เช็ค role เอง · เหตุผล: สามบทบาทเห็นคนละขอบเขต และหัวหน้า/แคชเชียร์ห้ามเห็นทุนสินค้า
--   (pos_items เป็นของเจ้าของเท่านั้น) — RPC เลือกคอลัมน์ที่ส่งออกได้ policy ทำไม่ได้ (§5 RLS คุมแถว ไม่ใช่คอลัมน์)
-- · 🔴 บทบาทใหม่ = ทุก policy ที่เดิมแปลว่า "ไม่ใช่เจ้าของ = หัวหน้าโครงการ" ต้องถูกถามใหม่ (§17 ข้อ 29)
--   ไล่แล้วเจอสองที่: `advances_insert/update` (ใครก็ยื่นคำขอเบิกได้ถ้าไม่ผูกโครงการ) และ
--   `employees_select` (ใครที่ล็อกอินก็อ่านรายชื่อคนงานได้) → ผูกกับ `is_supervisor()`

-- ── 1 · helper บทบาท ────────────────────────────────────────────────────
create or replace function public.is_supervisor()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'site_supervisor' and is_active
  );
$$;
revoke execute on function public.is_supervisor() from public, anon;
grant execute on function public.is_supervisor() to authenticated;

create or replace function public.is_cashier()
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'cashier' and is_active
  );
$$;
revoke execute on function public.is_cashier() from public, anon;
grant execute on function public.is_cashier() to authenticated;

-- ── 2 · ปิดรูของบทบาทใหม่ในตารางเดิม ──────────────────────────────────
-- คัดลอกจาก 20260922100000_advance_site_optional.sql · เพิ่มแค่ `is_supervisor()` ในกิ่งที่ไม่ใช่เจ้าของ
drop policy if exists advances_insert on public.advances;
create policy advances_insert on public.advances
  for insert to authenticated with check (
    (select public.is_owner())
    or ((select public.is_supervisor())
        and created_by = (select auth.uid())
        and (site_id is null or public.supervises_site(site_id)))
  );

drop policy if exists advances_update on public.advances;
create policy advances_update on public.advances
  for update to authenticated
  using (
    (select public.is_owner())
    or ((select public.is_supervisor())
        and created_by = (select auth.uid()) and status in ('pending', 'rejected'))
  )
  with check (
    (select public.is_owner())
    or ((select public.is_supervisor())
        and created_by = (select auth.uid())
        and (site_id is null or public.supervises_site(site_id)))
  );

-- คัดลอกจาก 20260830230000_p4_employees_attendance.sql · แคชเชียร์ไม่เห็นรายชื่อ/ค่าแรงคนงาน
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using ((select public.is_owner()) or (is_active and (select public.is_supervisor())));

-- ── 3 · ตาราง ───────────────────────────────────────────────────────────
create sequence if not exists public.material_request_no_seq;

create table if not exists public.material_requests (
  id            uuid primary key default gen_random_uuid(),
  request_no    text not null unique,
  site_id       uuid references public.sites(id) on delete set null,
  employee_id   uuid references public.employees(id) on delete set null,   -- ช่างที่มารับ (ไม่บังคับ)
  requested_by  uuid not null references public.profiles(id),
  status        text not null default 'open' check (status in ('open', 'issued', 'cancelled')),
  note          text check (note is null or length(note) <= 500),
  issued_by     uuid references public.profiles(id),
  issued_at     timestamptz,
  cancelled_by  uuid references public.profiles(id),
  cancelled_at  timestamptz,
  via_line      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists material_requests_status_idx on public.material_requests (status, created_at);
create index if not exists material_requests_requested_by_idx on public.material_requests (requested_by, created_at desc);
create index if not exists material_requests_site_idx on public.material_requests (site_id);
create index if not exists material_requests_employee_idx on public.material_requests (employee_id);
create index if not exists material_requests_issued_by_idx on public.material_requests (issued_by);
create index if not exists material_requests_cancelled_by_idx on public.material_requests (cancelled_by);

create table if not exists public.material_request_lines (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.material_requests(id) on delete cascade,
  seq         int not null,
  variant_id  text not null references public.pos_items(variant_id),
  qty         numeric(14,3) not null check (qty > 0 and qty <= 100000),
  unique (request_id, seq)
);
create index if not exists material_request_lines_variant_idx on public.material_request_lines (variant_id);

alter table public.material_requests      enable row level security;
alter table public.material_request_lines enable row level security;

drop policy if exists material_requests_owner_select on public.material_requests;
create policy material_requests_owner_select on public.material_requests for select to authenticated
  using ((select public.is_owner()));
drop policy if exists material_request_lines_owner_select on public.material_request_lines;
create policy material_request_lines_owner_select on public.material_request_lines for select to authenticated
  using ((select public.is_owner()));
-- ไม่มี policy insert/update/delete — เขียนผ่าน RPC ด้านล่างเท่านั้น

do $$
declare t text;
begin
  foreach t in array array['material_requests', 'material_request_lines'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                      for each row execute function public.audit_row()', t, t);
  end loop;
end $$;
drop trigger if exists material_requests_set_updated_at on public.material_requests;
create trigger material_requests_set_updated_at before update on public.material_requests
  for each row execute function public.set_updated_at();

-- ── 4 · บทบาทของคนที่เรียก (null = ไม่ได้ล็อกอินหรือถูกปิด) ─────────────
create or replace function public._my_role()
returns text
language sql stable security definer set search_path = '' as $$
  select role::text from public.profiles where id = auth.uid() and is_active
$$;
revoke execute on function public._my_role() from public, anon, authenticated;

-- ── 5 · ค้นหาสินค้า (ไม่มีทุน · ไม่มีราคา) ─────────────────────────────
create or replace function public.pos_item_search(p_q text, p_limit int default 20)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := public._my_role();
  v_q    text := btrim(coalesce(p_q, ''));
  v_pat  text;
begin
  if v_role is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  -- escape ตัวพิเศษของ ilike · ไม่งั้นพิมพ์ "%" แล้วได้สินค้าทั้งร้าน
  v_pat := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.name)
    from (
      select i.variant_id, i.name, i.variant_name, i.sku, i.barcode, i.category,
             i.track_stock, i.in_stock
      from public.pos_items i
      where i.is_active
        and (v_q = '' or i.name ilike v_pat or i.sku ilike v_pat or i.barcode = v_q)
      order by i.name
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
    ) x
  ), '[]'::jsonb);
end $$;
revoke execute on function public.pos_item_search(text, int) from public, anon;
grant  execute on function public.pos_item_search(text, int) to authenticated;

-- ── 6 · สร้างใบขอเบิก ───────────────────────────────────────────────────
create or replace function public.material_request_create(
  p_site uuid, p_employee uuid, p_note text, p_lines jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role text := public._my_role();
  v_id   uuid;
  v_no   text;
  v_n    int;
  v_site text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  r      record;
  v_seq  int := 0;
begin
  if v_role is null or v_role not in ('owner', 'site_supervisor') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select name into v_site from public.sites where id = p_site;
  if v_site is null then raise exception 'MR_SITE_REQUIRED'; end if;
  if v_role = 'site_supervisor' and not public.supervises_site(p_site) then
    raise exception 'MR_SITE_FORBIDDEN';
  end if;
  if p_employee is not null and not exists (
    select 1 from public.employees where id = p_employee and is_active
  ) then
    raise exception 'MR_EMPLOYEE_INVALID';
  end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'MR_NOTE_TOO_LONG'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'MR_LINES_REQUIRED'; end if;
  v_n := jsonb_array_length(p_lines);
  if v_n = 0 then raise exception 'MR_LINES_REQUIRED'; end if;
  if v_n > 50 then raise exception 'MR_TOO_MANY_LINES'; end if;

  v_no := 'RQ' || lpad(nextval('public.material_request_no_seq')::text, 4, '0');
  insert into public.material_requests (request_no, site_id, employee_id, requested_by, note)
  values (v_no, p_site, p_employee, auth.uid(), v_note)
  returning id into v_id;

  for r in select * from jsonb_to_recordset(p_lines) as l(variant_id text, qty numeric) loop
    if r.variant_id is null or not exists (
      select 1 from public.pos_items where variant_id = r.variant_id and is_active
    ) then
      raise exception 'MR_ITEM_INVALID';
    end if;
    if r.qty is null or r.qty <= 0 or r.qty > 100000 then raise exception 'MR_QTY_INVALID'; end if;
    v_seq := v_seq + 1;
    insert into public.material_request_lines (request_id, seq, variant_id, qty)
    values (v_id, v_seq, r.variant_id, round(r.qty, 3));
  end loop;

  -- แจ้งแคชเชียร์ทุกคนที่เปิดใช้งาน (กระดิ่ง + web push ผ่านตัวส่งเดิม)
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, 'material_request', 'มีใบขอเบิกวัสดุใหม่ ' || v_no,
         'โครงการ ' || v_site || ' · ' || v_n || ' รายการ', '/pickup'
  from public.profiles p
  where p.role = 'cashier' and p.is_active;

  return jsonb_build_object('id', v_id, 'request_no', v_no);
end $$;
revoke execute on function public.material_request_create(uuid, uuid, text, jsonb) from public, anon;
grant  execute on function public.material_request_create(uuid, uuid, text, jsonb) to authenticated;

-- ── 7 · แคชเชียร์จ่ายของ / ยกเลิก ──────────────────────────────────────
create or replace function public.material_request_issue(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role   text := public._my_role();
  v_status text;
  v_no     text;
begin
  if v_role is null or v_role not in ('owner', 'cashier') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select status, request_no into v_status, v_no from public.material_requests where id = p_id for update;
  if v_status is null then raise exception 'MR_NOT_FOUND'; end if;
  if v_status <> 'open' then raise exception 'MR_NOT_OPEN' using detail = v_status; end if;
  update public.material_requests
     set status = 'issued', issued_by = auth.uid(), issued_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'request_no', v_no, 'status', 'issued');
end $$;
revoke execute on function public.material_request_issue(uuid) from public, anon;
grant  execute on function public.material_request_issue(uuid) to authenticated;

create or replace function public.material_request_cancel(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role   text := public._my_role();
  v_status text;
  v_by     uuid;
  v_no     text;
begin
  if v_role is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select status, requested_by, request_no into v_status, v_by, v_no
    from public.material_requests where id = p_id for update;
  if v_status is null then raise exception 'MR_NOT_FOUND'; end if;
  -- เจ้าของยกเลิกได้ทุกใบ · หัวหน้าโครงการยกเลิกได้เฉพาะใบที่ตัวเองยื่น · แคชเชียร์ยกเลิกไม่ได้
  if not (v_role = 'owner' or (v_role = 'site_supervisor' and v_by = auth.uid())) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_status <> 'open' then raise exception 'MR_NOT_OPEN' using detail = v_status; end if;
  update public.material_requests
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_id;
  return jsonb_build_object('id', p_id, 'request_no', v_no, 'status', 'cancelled');
end $$;
revoke execute on function public.material_request_cancel(uuid) from public, anon;
grant  execute on function public.material_request_cancel(uuid) to authenticated;

-- ── 8 · รายการใบขอเบิก (ขอบเขตตามบทบาท) ────────────────────────────────
-- เจ้าของ + แคชเชียร์: ทุกใบ · หัวหน้าโครงการ: เฉพาะใบที่ตัวเองยื่น
-- ใบที่รอจ่ายเรียงเก่าก่อน (คิวของแคชเชียร์) · ใบที่จบแล้วเรียงใหม่ก่อน
create or replace function public.material_requests_feed(
  p_status text default 'open', p_limit int default 30, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role  text := public._my_role();
  v_mine  boolean;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_off   int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows  jsonb;
begin
  if v_role is null then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('open', 'issued', 'cancelled') then raise exception 'MR_STATUS_INVALID'; end if;
  v_mine := v_role = 'site_supervisor';

  select count(*) into v_total from public.material_requests m
   where m.status = p_status and (not v_mine or m.requested_by = auth.uid());

  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb) into v_rows
  from (
    select row_number() over (
             order by case when p_status = 'open' then m.created_at end asc,
                      case when p_status <> 'open' then coalesce(m.issued_at, m.cancelled_at, m.created_at) end desc
           ) as ord,
           jsonb_build_object(
             'id', m.id, 'request_no', m.request_no, 'status', m.status, 'note', m.note,
             'created_at', m.created_at, 'issued_at', m.issued_at, 'cancelled_at', m.cancelled_at,
             'site', s.name, 'requested_by', rb.full_name, 'employee', e.full_name,
             'issued_by', ib.full_name, 'mine', m.requested_by = auth.uid(),
             'lines', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'variant_id', l.variant_id, 'qty', l.qty, 'name', i.name,
                        'variant_name', i.variant_name, 'sku', i.sku, 'barcode', i.barcode,
                        'track_stock', i.track_stock, 'in_stock', i.in_stock) order by l.seq)
               from public.material_request_lines l
               join public.pos_items i on i.variant_id = l.variant_id
               where l.request_id = m.id), '[]'::jsonb)
           ) as j
    from public.material_requests m
    left join public.sites s     on s.id = m.site_id
    left join public.profiles rb on rb.id = m.requested_by
    left join public.profiles ib on ib.id = m.issued_by
    left join public.employees e on e.id = m.employee_id
    where m.status = p_status and (not v_mine or m.requested_by = auth.uid())
    order by case when p_status = 'open' then m.created_at end asc,
             case when p_status <> 'open' then coalesce(m.issued_at, m.cancelled_at, m.created_at) end desc
    limit v_limit offset v_off
  ) x;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;
revoke execute on function public.material_requests_feed(text, int, int) from public, anon;
grant  execute on function public.material_requests_feed(text, int, int) to authenticated;

-- ตัวเลขบนเมนู "ใบเบิกรอจ่าย" (เจ้าของ + แคชเชียร์) · "เบิกวัสดุ" ของหัวหน้า = ใบของตัวเองที่ยังรอจ่าย
create or replace function public.material_requests_open_count()
returns int
language sql stable security definer set search_path = '' as $$
  select case
    when public._my_role() in ('owner', 'cashier') then
      (select count(*)::int from public.material_requests where status = 'open')
    when public._my_role() = 'site_supervisor' then
      (select count(*)::int from public.material_requests where status = 'open' and requested_by = auth.uid())
    else 0 end
$$;
revoke execute on function public.material_requests_open_count() from public, anon;
grant  execute on function public.material_requests_open_count() to authenticated;
