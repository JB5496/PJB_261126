-- 주 4.5일제 근무 현황 점검 — Supabase 설정 SQL (docs/design.md 6절)
-- Supabase 관리 화면 → SQL Editor → 이 파일 내용을 붙여 넣고 Run.
-- 맨 아래 '접근 코드' 한 줄의 값을 바꾼 뒤 실행하십시오. 실제 접근 코드는 이 레포에 커밋하지 않습니다.
--
-- 구조
--   org_snapshot   : 조직(대상 금요일·부서원 명단) 저장 이력. 가장 최근 줄이 현재 조직.
--   attendance_log : 근태 저장 이력. 저장할 때마다 한 줄씩 쌓이고, 화면은 사람·날짜별 가장 최근 줄을 쓴다.
--   app_config     : 접근 코드.
--   세 표 모두 행 수준 보안(RLS)을 켜고 정책을 두지 않아, 웹앱 키로는 표를 직접 읽거나 쓸 수 없다.
--   웹앱은 접근 코드를 확인하는 함수(app_pull·app_save_attendance·app_save_org·app_import)로만 쓴다.

create table if not exists public.app_config (
  k text primary key,
  v text not null
);

create table if not exists public.org_snapshot (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  target_friday text not null,
  members jsonb not null check (jsonb_typeof(members) = 'array')
);

create table if not exists public.attendance_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  member_id text not null,
  date text not null,
  absent_type text not null check (absent_type in ('없음', '휴가', '출장')),
  absent_hours numeric not null check (absent_hours >= 0 and absent_hours <= 8)
);
create index if not exists attendance_log_key on public.attendance_log (member_id, date, id desc);

alter table public.app_config enable row level security;
alter table public.org_snapshot enable row level security;
alter table public.attendance_log enable row level security;
revoke all on public.app_config, public.org_snapshot, public.attendance_log from anon, authenticated;

-- 접근 코드 확인 — 틀리면 ACCESS_DENIED
create or replace function public.app_check(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_code is null or not exists (select 1 from app_config where k = 'access_code' and v = p_code) then
    raise exception 'ACCESS_DENIED';
  end if;
end $$;

-- 현재 상태 읽기: 2절 JSON 모양 {targetFriday, members, attendance} + version(바뀌었는지 비교용)
create or replace function public.app_pull(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s org_snapshot; att jsonb;
begin
  perform app_check(p_code);
  select * into s from org_snapshot order by id desc limit 1;
  if s.id is null then
    return jsonb_build_object('targetFriday', '', 'members', '[]'::jsonb, 'attendance', '[]'::jsonb, 'version', '0');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', l.member_id, 'date', l.date,
           'absentType', l.absent_type, 'absentHours', l.absent_hours) order by l.id), '[]'::jsonb)
    into att
    from (select distinct on (member_id, date) * from attendance_log
          where member_id in (select m->>'id' from jsonb_array_elements(s.members) m)
          order by member_id, date, id desc) l;
  return jsonb_build_object('targetFriday', s.target_friday, 'members', s.members, 'attendance', att,
    'version', s.id::text || '-' || coalesce((select max(id) from attendance_log), 0)::text);
end $$;

-- 근태 한 건 저장(쌓기). p_trainee가 null이 아니면 그 사람의 교육대상자 표시도 바꾼다(조직 새 줄).
create or replace function public.app_save_attendance(p_code text, p_id text, p_date text,
  p_type text, p_hours numeric, p_trainee boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s org_snapshot; nm jsonb;
begin
  perform app_check(p_code);
  select * into s from org_snapshot order by id desc limit 1;
  if s.id is null or not exists (select 1 from jsonb_array_elements(s.members) m where m->>'id' = p_id) then
    raise exception 'UNKNOWN_MEMBER';
  end if;
  insert into attendance_log (member_id, date, absent_type, absent_hours) values (p_id, p_date, p_type, p_hours);
  if p_trainee is not null and exists (select 1 from jsonb_array_elements(s.members) m
       where m->>'id' = p_id and coalesce((m->>'trainee')::boolean, false) <> p_trainee) then
    select jsonb_agg(case when m->>'id' = p_id then jsonb_set(m, '{trainee}', to_jsonb(p_trainee)) else m end order by o)
      into nm from jsonb_array_elements(s.members) with ordinality t(m, o);
    insert into org_snapshot (target_friday, members) values (s.target_friday, nm);
  end if;
  return app_pull(p_code);
end $$;

-- 조직 저장(새 줄). 명단에서 빠진 사람의 근태 이력은 지우지 않고, 읽을 때만 뺀다.
create or replace function public.app_save_org(p_code text, p_friday text, p_members jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform app_check(p_code);
  insert into org_snapshot (target_friday, members) values (coalesce(p_friday, ''), p_members);
  return app_pull(p_code);
end $$;

-- 가져오기(표본·백업): 조직 새 줄 + 근태를 순서대로 쌓는다. 같은 사람·날짜가 여러 건이면 마지막 건이 남는다.
create or replace function public.app_import(p_code text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb;
begin
  perform app_check(p_code);
  insert into org_snapshot (target_friday, members)
    values (coalesce(p_data->>'targetFriday', ''), coalesce(p_data->'members', '[]'::jsonb));
  for a in select * from jsonb_array_elements(coalesce(p_data->'attendance', '[]'::jsonb)) loop
    insert into attendance_log (member_id, date, absent_type, absent_hours)
      values (a->>'id', a->>'date', a->>'absentType', (a->>'absentHours')::numeric);
  end loop;
  return app_pull(p_code);
end $$;

revoke execute on function public.app_check(text) from public, anon, authenticated;
grant execute on function public.app_pull(text) to anon;
grant execute on function public.app_save_attendance(text, text, text, text, numeric, boolean) to anon;
grant execute on function public.app_save_org(text, text, jsonb) to anon;
grant execute on function public.app_import(text, jsonb) to anon;

-- 접근 코드: '여기에-접근-코드' 를 직원과 나눌 코드(12자 이상 권장)로 바꾸고 실행하십시오.
insert into public.app_config (k, v) values ('access_code', '여기에-접근-코드')
  on conflict (k) do update set v = excluded.v;
