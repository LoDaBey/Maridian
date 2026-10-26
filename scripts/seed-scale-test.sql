-- Local performance test only: a "Scale test" sheet with 3 monthly tabs x 100,000 items.
-- Run against a development database, never production.
DO $$
DECLARE
  ws uuid := (SELECT id FROM monitor_workspaces ORDER BY created_at LIMIT 1);
  owner uuid := (SELECT id FROM monitor_users WHERE role = 'admin' ORDER BY created_at LIMIT 1);
  wb uuid := gen_random_uuid();
  people uuid[] := ARRAY(SELECT id FROM monitor_users WHERE is_active ORDER BY created_at);
  tab record;
  sid uuid; c_name uuid; c_status uuid; c_type uuid; c_person uuid; c_date uuid; c_country uuid; c_pages uuid; g uuid;
  month_start date;
BEGIN
  INSERT INTO monitor_workbooks (id, name, position, created_by, workspace_id) VALUES (wb, 'Scale test', 'zz', owner, ws);
  INSERT INTO monitor_workbook_members (workbook_id, user_id, role, added_by) VALUES (wb, owner, 'owner', owner);
  FOR tab IN SELECT * FROM (VALUES (1, 'Aug 2026', '2026-08-01'::date), (2, 'Sep 2026', '2026-09-01'::date), (3, 'Oct 2026', '2026-10-01'::date)) AS t(n, name, start) LOOP
    sid := gen_random_uuid(); c_name := gen_random_uuid(); c_status := gen_random_uuid(); c_type := gen_random_uuid();
    c_person := gen_random_uuid(); c_date := gen_random_uuid(); c_country := gen_random_uuid(); c_pages := gen_random_uuid(); g := gen_random_uuid();
    month_start := tab.start;
    INSERT INTO monitor_sheets (id, workbook_id, name, position, direction, created_by) VALUES (sid, wb, tab.name, 'a' || tab.n, 'rtl', owner);
    INSERT INTO monitor_groups (id, sheet_id, name, color, position, created_by) VALUES (g, sid, 'Reports', '#579bfc', 'a0', owner);
    INSERT INTO monitor_columns (id, sheet_id, name, type, position, settings) VALUES
      (c_name, sid, 'اسم التقرير', 'text', 'a0', '{}'),
      (c_status, sid, 'الحالة', 'status', 'a1', '{"options":[{"id":"s1","label":"تم","color":"#00c875"},{"id":"s2","label":"جاري العمل عليه","color":"#fdab3d"},{"id":"s3","label":"متوقف","color":"#e2445c"}]}'),
      (c_type, sid, 'نوع التقرير', 'status', 'a2', '{"options":[{"id":"t1","label":"يومي","color":"#fdab3d"},{"id":"t2","label":"أسبوعي","color":"#e2445c"},{"id":"t3","label":"ردود أفعال","color":"#a25ddc"},{"id":"t4","label":"استقصائي","color":"#00c875"},{"id":"t5","label":"رصد","color":"#784bd1"}]}'),
      (c_person, sid, 'المحرر', 'person', 'a3', '{"multiple":true}'),
      (c_date, sid, 'التاريخ', 'date', 'a4', '{}'),
      (c_country, sid, 'الدولة', 'country', 'a5', '{}'),
      (c_pages, sid, 'Pages', 'number', 'a6', '{}');
    INSERT INTO monitor_rows (id, sheet_id, position, group_id, item_number, created_by, data)
    SELECT gen_random_uuid(), sid, lpad(i::text, 7, '0'), g, i, people[1 + (i % array_length(people, 1))],
      jsonb_build_object(
        c_name::text, 'تقرير رقم ' || i,
        c_status::text, (ARRAY['s1','s1','s1','s2','s3'])[1 + (i % 5)],
        c_type::text, (ARRAY['t1','t1','t2','t3','t4','t5'])[1 + (i % 6)],
        c_person::text, jsonb_build_array(people[1 + ((i * 7) % array_length(people, 1))]),
        c_date::text, to_char(month_start + (i % 28), 'YYYY-MM-DD'),
        c_country::text, (ARRAY['AE','SA','EG','IR','IL','SD','YE','US'])[1 + (i % 8)],
        c_pages::text, 1 + (i % 40)
      )
    FROM generate_series(1, 100000) AS i;
  END LOOP;
END $$;
