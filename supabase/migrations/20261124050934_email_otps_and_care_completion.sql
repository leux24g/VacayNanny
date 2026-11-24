begin;
-- One-time codes are never stored in plain text. Token payloads are encrypted by the server.
create table public.otp_challenges (
 id uuid primary key, purpose text not null check(purpose in ('login','signup','care')),
 subject_key text not null, code_hash text not null, payload jsonb not null default '{}',
 booking_id uuid references public.bookings(id) on delete cascade,
 nanny_id uuid references public.nannies(id), booking_version bigint,
 expires_at timestamptz not null default now()+interval '10 minutes',
 attempts integer not null default 0, consumed_at timestamptz,
 created_at timestamptz not null default now()
);
create index otp_challenges_subject_idx on public.otp_challenges(subject_key,created_at desc);
alter table public.otp_challenges enable row level security;
revoke all on public.otp_challenges from public,anon,authenticated;
grant all on public.otp_challenges to service_role;
alter table public.booking_assignments add column completed_at timestamptz;

-- Exact lookup is needed to avoid creating accounts from sign-in requests. Server-only,
-- because it reads the private Auth schema; no account enumeration endpoint is exposed.
create function public.otp_email_user(p_email text) returns uuid language sql security definer set search_path='' as $$
 select id from auth.users where lower(email)=lower(p_email) limit 1;
$$;

create function public.issue_otp_challenge(p_id uuid,p_purpose text,p_subject text,p_hash text,p_payload jsonb,p_actor uuid default null,p_booking uuid default null)
returns uuid language plpgsql set search_path=public as $$
declare b public.bookings; selected_nanny uuid;
begin
 if p_purpose not in ('login','signup','care') then raise exception 'Invalid verification purpose.'; end if;
 if p_purpose='care' then
  select * into b from public.bookings where id=p_booking for update;
  if not found or b.status<>'in_progress' or b.payment_status not in ('paid','not_required') or b.parent_confirmed_at is null then raise exception 'Care must be in progress before requesting a completion code.'; end if;
  select n.id into selected_nanny from public.booking_assignments a join public.nannies n on n.id=a.nanny_id
  where a.booking_id=b.id and n.user_id=p_actor and not n.is_suspended and a.response='accepted' and a.completed_at is null;
  if selected_nanny is null then raise insufficient_privilege using message='Only the assigned nanny can request their completion code.'; end if;
  if (select count(*) from public.booking_assignments where booking_id=b.id and response='accepted')<>b.nannies_needed::integer then raise exception 'The complete care team must accept first.'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_subject,3));
 if exists(select 1 from public.otp_challenges where subject_key=p_subject and created_at>now()-interval '60 seconds' and consumed_at is null) then raise exception using errcode='P0001',message='Wait one minute before requesting another code.'; end if;
 update public.otp_challenges set consumed_at=now() where subject_key=p_subject and consumed_at is null;
 insert into public.otp_challenges(id,purpose,subject_key,code_hash,payload,booking_id,nanny_id,booking_version)
 values(p_id,p_purpose,p_subject,p_hash,p_payload,p_booking,selected_nanny,b.version);
 delete from public.otp_challenges where expires_at<now()-interval '1 day';
 return p_id;
end $$;

create function public.consume_otp_challenge(p_id uuid,p_purpose text,p_hash text,p_actor uuid default null,p_booking uuid default null)
returns jsonb language plpgsql set search_path=public as $$
declare c public.otp_challenges; b public.bookings; all_done boolean;
begin
 -- Always lock booking before challenge, matching issuance and other booking actions.
 if p_purpose='care' then
  select * into b from public.bookings where id=p_booking for update;
  if not found then return jsonb_build_object('ok',false); end if;
 end if;
 select * into c from public.otp_challenges where id=p_id and purpose=p_purpose for update;
 if not found or c.consumed_at is not null or c.expires_at<=now() or c.attempts>=5 then return jsonb_build_object('ok',false); end if;
 if p_purpose='care' then
  if c.booking_id is distinct from p_booking or c.booking_version<>b.version or b.status<>'in_progress' then return jsonb_build_object('ok',false); end if;
  if not exists(select 1 from public.booking_assignments a join public.nannies n on n.id=a.nanny_id where a.booking_id=b.id and a.nanny_id=c.nanny_id and a.response='accepted' and a.completed_at is null and n.user_id=p_actor and not n.is_suspended) then raise insufficient_privilege; end if;
 end if;
 if c.code_hash<>p_hash then
  update public.otp_challenges set attempts=attempts+1 where id=c.id;
  return jsonb_build_object('ok',false);
 end if;
 update public.otp_challenges set consumed_at=now() where id=c.id;
 if p_purpose='care' then
  update public.booking_assignments set completed_at=now() where booking_id=b.id and nanny_id=c.nanny_id;
  select count(*)=b.nannies_needed::integer and bool_and(completed_at is not null) into all_done from public.booking_assignments where booking_id=b.id;
  if all_done then update public.bookings set status='completed' where id=b.id; end if;
  insert into public.workflow_audit(actor_id,entity_type,entity_id,action,details) values(p_actor,'booking',b.id,'care_completion_verified',jsonb_build_object('nannyId',c.nanny_id,'bookingCompleted',all_done));
  return jsonb_build_object('ok',true,'completed',all_done);
 end if;
 return jsonb_build_object('ok',true,'payload',c.payload);
end $$;

-- Stops date-based and admin status edits from skipping family confirmation.
create function public.require_care_completion() returns trigger language plpgsql set search_path=public as $$
begin
 if new.status='completed' and old.status<>'completed' then
  if old.status<>'in_progress' or (select count(*) from public.booking_assignments where booking_id=new.id and completed_at is not null)<>new.nannies_needed::integer then raise exception 'Each nanny must enter the family completion code before closing care.'; end if;
 end if;
 return new;
end $$;
create trigger require_care_completion before update on public.bookings for each row execute function public.require_care_completion();
create function public.clear_care_completion() returns trigger language plpgsql set search_path=public as $$
begin
 if new.check_in is distinct from old.check_in or new.check_out is distinct from old.check_out or new.status='matched' and old.status<>'matched' then
  update public.booking_assignments set completed_at=null where booking_id=new.id;
  update public.otp_challenges set consumed_at=now() where booking_id=new.id and consumed_at is null;
 end if;
 return new;
end $$;
create trigger clear_care_completion after update on public.bookings for each row execute function public.clear_care_completion();

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('otp_email_user','issue_otp_challenge','consume_otp_challenge','require_care_completion','clear_care_completion') loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
