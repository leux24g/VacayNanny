begin;
-- Pending passwordless challenges must not authenticate through the new flow.
update public.otp_challenges set consumed_at=now() where consumed_at is null and purpose in ('login','signup');
create table public.otp_verified_sessions (
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 verified_at timestamptz not null default now()
);
create index otp_verified_sessions_user_idx on public.otp_verified_sessions(user_id);
alter table public.otp_verified_sessions enable row level security;
revoke all on public.otp_verified_sessions from public,anon,authenticated;
grant all on public.otp_verified_sessions to service_role;

-- Reads only the current caller's session. Definer access is needed for this private table.
create function public.has_email_otp_session() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.otp_verified_sessions s
 where s.user_id=(select auth.uid()) and s.session_id::text=(select auth.jwt()->>'session_id'));
$$;
revoke all on function public.has_email_otp_session() from public;
grant execute on function public.has_email_otp_session() to anon,authenticated,service_role;

-- Called exclusively by the server after both factors have been verified.
create function public.record_email_otp_session(p_session uuid,p_user uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_user) then return false; end if;
 insert into public.otp_verified_sessions(session_id,user_id) values(p_session,p_user)
 on conflict(session_id) do update set verified_at=now();
 return true;
end $$;
revoke all on function public.record_email_otp_session(uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_email_otp_session(uuid,uuid) to service_role;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.has_email_otp_session() and exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin');
$$;
create or replace function public.current_role() returns public.user_role language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=(select auth.uid()) and public.has_email_otp_session();
$$;

-- Avoid recursive profile self-lookups; the existing identity/role trigger protects fields.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));

-- Server routes bypass RLS only after their own per-session check. Native password
-- tokens alone cannot read private data or mutate public tables through PostgREST.
do $$ declare t record; begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity loop
  execute format('create policy otp_required_insert on public.%I as restrictive for insert to authenticated with check ((select public.has_email_otp_session()))',t.relname);
  execute format('create policy otp_required_update on public.%I as restrictive for update to authenticated using ((select public.has_email_otp_session())) with check ((select public.has_email_otp_session()))',t.relname);
  execute format('create policy otp_required_delete on public.%I as restrictive for delete to authenticated using ((select public.has_email_otp_session()))',t.relname);
  if t.relname not in ('destinations','nannies','reviews','pricing_tiers','care_packages','pricing_addons','business_policies','faqs','homepage_steps') then
   execute format('create policy otp_required_read on public.%I as restrictive for select to authenticated using ((select public.has_email_otp_session()))',t.relname);
  end if;
 end loop;
end $$;
create policy otp_required_hidden_nannies on public.nannies as restrictive for select to authenticated using(is_active or (select public.has_email_otp_session()));
create policy otp_required_private_reviews on public.reviews as restrictive for select to authenticated using(is_published or (select public.has_email_otp_session()));
create policy otp_required_documents on storage.objects as restrictive for select to authenticated using(bucket_id<>'nanny-documents' or (select public.has_email_otp_session()));
create policy otp_required_storage_insert on storage.objects as restrictive for insert to authenticated with check((select public.has_email_otp_session()));
create policy otp_required_storage_update on storage.objects as restrictive for update to authenticated using((select public.has_email_otp_session())) with check((select public.has_email_otp_session()));
create policy otp_required_storage_delete on storage.objects as restrictive for delete to authenticated using((select public.has_email_otp_session()));
commit;
