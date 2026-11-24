begin;
alter table public.booking_assignments add column completion_report jsonb;
alter table public.booking_assignments add column report_submitted_at timestamptz;
alter table public.booking_assignments add constraint completion_report_object check(completion_report is null or jsonb_typeof(completion_report)='object');

create function public.save_care_completion_report(p_booking uuid,p_actor uuid,p_report jsonb) returns jsonb language plpgsql set search_path='' as $$
declare b public.bookings; assignment public.booking_assignments; report jsonb; hours numeric;
begin
 select * into b from public.bookings where id=p_booking for update;
 if not found or b.status<>'in_progress' then raise exception 'Care must be in progress before submitting a completion report.'; end if;
 select a.* into assignment from public.booking_assignments a join public.nannies n on n.id=a.nanny_id where a.booking_id=b.id and n.user_id=p_actor and not n.is_suspended and a.response='accepted' for update of a;
 if not found or assignment.completed_at is not null then raise exception 'Only the assigned nanny can submit an unconfirmed report.'; end if;
 hours=(p_report->>'hoursWorked')::numeric;
 if hours is null or hours<=0 or hours>greatest(1,b.check_out-b.check_in)*24 or hours*4<>trunc(hours*4)
 or length(trim(coalesce(p_report->>'summary','')))<10 or length(p_report->>'summary')>2000
 or length(coalesce(p_report->>'additionalServices',''))>1000 or length(coalesce(p_report->>'expenses',''))>1000
 or p_report->>'accuracy' is distinct from 'true' then raise exception 'Complete a valid, accurate report before requesting client confirmation.'; end if;
 report=jsonb_build_object('hoursWorked',hours,'summary',trim(p_report->>'summary'),'additionalServices',trim(coalesce(p_report->>'additionalServices','')),'expenses',trim(coalesce(p_report->>'expenses','')),'accuracy',true,'dateFrom',b.check_in,'dateTo',b.check_out,'bookingVersion',b.version);
 if assignment.completion_report is distinct from report then
  update public.booking_assignments set completion_report=report,report_submitted_at=now() where booking_id=b.id and nanny_id=assignment.nanny_id;
  update public.otp_challenges set consumed_at=now() where booking_id=b.id and nanny_id=assignment.nanny_id and purpose='care' and consumed_at is null;
  insert into public.workflow_audit(actor_id,entity_type,entity_id,action,details) values(p_actor,'booking',b.id,'completion_report_submitted',jsonb_build_object('nannyId',assignment.nanny_id));
 end if;
 return report;
end $$;
create or replace function public.issue_otp_challenge(p_id uuid,p_purpose text,p_subject text,p_hash text,p_payload jsonb,p_actor uuid default null,p_booking uuid default null)
returns uuid language plpgsql set search_path=public as $$
declare b public.bookings; selected_nanny uuid;
begin
 if p_purpose not in ('login','signup','care') then raise exception 'Invalid verification purpose.'; end if;
 if p_purpose='care' then
  select * into b from public.bookings where id=p_booking for update;
  if not found or b.status<>'in_progress' or b.payment_status not in ('paid','not_required') or b.parent_confirmed_at is null then raise exception 'Care must be in progress before requesting a completion code.'; end if;
  select n.id into selected_nanny from public.booking_assignments a join public.nannies n on n.id=a.nanny_id
  where a.booking_id=b.id and n.user_id=p_actor and not n.is_suspended and a.response='accepted' and a.completed_at is null;
  if not exists(select 1 from public.booking_assignments a where a.booking_id=b.id and a.nanny_id=selected_nanny and a.completion_report is not null and a.completion_report=p_payload->'report') then raise exception 'Submit the current completion report before requesting a client code.'; end if;
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

create or replace function public.consume_otp_challenge(p_id uuid,p_purpose text,p_hash text,p_actor uuid default null,p_booking uuid default null)
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
  if not exists(select 1 from public.booking_assignments a join public.nannies n on n.id=a.nanny_id where a.booking_id=b.id and a.nanny_id=c.nanny_id and a.response='accepted' and a.completed_at is null and a.completion_report is not null and a.completion_report=c.payload->'report' and n.user_id=p_actor and not n.is_suspended) then raise insufficient_privilege; end if;
 end if;
 if c.code_hash<>p_hash then
  update public.otp_challenges set attempts=attempts+1 where id=c.id;
  return jsonb_build_object('ok',false);
 end if;
 update public.otp_challenges set consumed_at=now() where id=c.id;
 if p_purpose='care' then
  update public.booking_assignments set completed_at=now() where booking_id=b.id and nanny_id=c.nanny_id;
  insert into public.ops_tasks(dedupe_key,kind,summary,booking_id) values('payout-review:'||b.id||':'||c.nanny_id,'payout_review','A nanny completion report has client confirmation. Check the report, agreed terms and payout details before manual payout.',b.id) on conflict(dedupe_key) do update set status='open',resolved_at=null;
  perform public.enqueue_workflow_job('ops_notice',jsonb_build_object('summary','A client-confirmed nanny completion report needs payout review.'),'payout-review:'||c.id);
  select count(*)=b.nannies_needed::integer and bool_and(completed_at is not null) into all_done from public.booking_assignments where booking_id=b.id;
  if all_done then update public.bookings set status='completed' where id=b.id; end if;
  insert into public.workflow_audit(actor_id,entity_type,entity_id,action,details) values(p_actor,'booking',b.id,'care_completion_verified',jsonb_build_object('nannyId',c.nanny_id,'bookingCompleted',all_done));
  return jsonb_build_object('ok',true,'completed',all_done);
 end if;
 return jsonb_build_object('ok',true,'payload',c.payload);
end $$;

create or replace function public.clear_care_completion() returns trigger language plpgsql set search_path=public as $$
begin
 if new.check_in is distinct from old.check_in or new.check_out is distinct from old.check_out or new.status='matched' and old.status<>'matched' then
  update public.booking_assignments set completed_at=null,completion_report=null,report_submitted_at=null where booking_id=new.id;
  update public.otp_challenges set consumed_at=now() where booking_id=new.id and consumed_at is null;
 end if;
 return new;
end $$;
revoke execute on function public.save_care_completion_report(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_care_completion_report(uuid,uuid,jsonb) to service_role;
commit;
