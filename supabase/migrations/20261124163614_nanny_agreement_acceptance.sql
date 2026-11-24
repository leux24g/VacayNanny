-- Versioned agreement acceptance is separate from signed-document review and activation.
begin;
create table public.nanny_agreement_acceptances (
 application_id uuid not null references public.nanny_applications(id) on delete cascade,
 version text not null, document_sha256 text not null check(document_sha256 ~ '^[0-9a-f]{64}$'),
 signer_name text not null check(length(signer_name) between 2 and 120),
 accepted_at timestamptz not null default now(), details jsonb not null,
 primary key(application_id,version),
 constraint encrypted_acceptance_details check(details ?& array['iv','tag','data'])
);
alter table public.nanny_agreement_acceptances enable row level security;
revoke all on public.nanny_agreement_acceptances from public,anon,authenticated;
grant all on public.nanny_agreement_acceptances to service_role;
alter table public.nanny_applications add column agreement_submitted_path text;
alter table public.nanny_applications add column agreement_submitted_at timestamptz;

create function public.nanny_agreement_is_current(p_application uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.nanny_agreement_acceptances
 where application_id=p_application and version='2026-11-24-revised'
 and document_sha256='9eb913dbb9d462385a60abf97ddb478dc48f13519aab258ae78d4257ba98fc71');
$$;
create function public.nanny_signup_application(p_email text) returns uuid language sql stable set search_path='' as $$
 select a.id from public.nanny_applications a where lower(a.email)=lower(p_email)
 and a.status<>'rejected' and public.nanny_agreement_is_current(a.id)
 order by a.created_at desc limit 1;
$$;

create function public.accept_nanny_agreement(p_application uuid,p_actor uuid,p_acceptance jsonb) returns void language plpgsql set search_path='' as $$
declare a public.nanny_applications;
begin
 select * into a from public.nanny_applications where id=p_application for update;
 if not found then raise exception 'Application not found.'; end if;
 if public.otp_email_user(a.email) is distinct from p_actor
 or (a.user_id is not null and a.user_id<>p_actor) then raise insufficient_privilege; end if;
 if a.status='rejected' then raise exception 'Contact VacayNanny before updating a rejected application.'; end if;
 if p_acceptance->>'version' is distinct from '2026-11-24-revised'
 or p_acceptance->>'document_sha256' is distinct from '9eb913dbb9d462385a60abf97ddb478dc48f13519aab258ae78d4257ba98fc71'
 or lower(regexp_replace(trim(p_acceptance->>'signer_name'),'\s+',' ','g')) is distinct from lower(regexp_replace(trim(a.full_name),'\s+',' ','g'))
 then raise exception 'Read and accept the current agreement using your application legal name.'; end if;
 insert into public.nanny_agreement_acceptances(application_id,version,document_sha256,signer_name,details)
 values(a.id,p_acceptance->>'version',p_acceptance->>'document_sha256',p_acceptance->>'signer_name',p_acceptance->'details') on conflict do nothing;
end $$;
create or replace function public.save_complete_application(p_row jsonb,p_references jsonb,p_documents jsonb) returns jsonb language plpgsql set search_path=public as $$
declare a public.nanny_applications; item jsonb; existing public.nanny_applications; acceptance jsonb=p_row->'agreement_acceptance';
begin
 if acceptance->>'version' is distinct from '2026-11-24-revised' or acceptance->>'document_sha256' is distinct from '9eb913dbb9d462385a60abf97ddb478dc48f13519aab258ae78d4257ba98fc71' or lower(regexp_replace(trim(acceptance->>'signer_name'),'\s+',' ','g')) is distinct from lower(regexp_replace(trim(p_row->>'full_name'),'\s+',' ','g')) then raise exception 'Read and accept the current nanny agreement before submitting.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_row->>'submission_key',0));
 select * into existing from public.nanny_applications where submission_key=(p_row->>'submission_key')::uuid;
 if found then
  if lower(existing.email)<>lower(p_row->>'email') then raise exception 'Submission key already used.'; end if;
  return jsonb_build_object('id',existing.id);
 end if;
 if not coalesce((p_row->>'consent_background')::boolean,false) or not coalesce((p_row->>'consent_terms')::boolean,false) or not coalesce((p_row->>'consent_accuracy')::boolean,false) then raise exception 'All application consents are required.'; end if;
 if (p_row->>'date_of_birth')::date > current_date-interval '21 years' then raise exception 'Applicants must be 21 years or older.'; end if;
 if jsonb_array_length(p_references)<>2 then raise exception 'Two references are required.'; end if;
 if exists(select kind from unnest(array['photo','id_front','id_back','selfie']) kind where not exists(select 1 from jsonb_array_elements(p_documents) d where d->>'kind'=kind)) then raise exception 'Required identity documents are missing.'; end if;
 insert into public.nanny_applications select (jsonb_populate_record(null::public.nanny_applications,p_row||jsonb_build_object('created_at',now(),'updated_at',now(),'status','pending','decision_version',0,'vetting_checks','{}'::jsonb))).* returning * into a;
 for item in select value from jsonb_array_elements(p_references) loop
  insert into public.nanny_references select (jsonb_populate_record(null::public.nanny_references,item||jsonb_build_object('id',gen_random_uuid(),'application_id',a.id,'created_at',now()))).*;
 end loop;
 for item in select value from jsonb_array_elements(p_documents) loop
  insert into public.nanny_documents select (jsonb_populate_record(null::public.nanny_documents,item||jsonb_build_object('id',gen_random_uuid(),'application_id',a.id,'created_at',now()))).*;
 end loop;
 insert into public.nanny_agreement_acceptances(application_id,version,document_sha256,signer_name,details) values(a.id,acceptance->>'version',acceptance->>'document_sha256',acceptance->>'signer_name',acceptance->'details');
 perform public.enqueue_workflow_job('application_received',jsonb_build_object('applicationId',a.id),'application-received:'||a.id);
 return jsonb_build_object('id',a.id);
end $$;

create or replace function public.claim_nanny_applications(p_actor uuid,p_verified_email text) returns integer language plpgsql set search_path=public as $$
declare a public.nanny_applications; linked integer=0;
begin
 if p_verified_email is null then raise exception 'Verify your email before linking an application.'; end if;
 -- The function is server-only; Auth.getUser supplies both arguments.
 perform pg_advisory_xact_lock(hashtextextended(lower(p_verified_email),1));
 for a in select * from public.nanny_applications where lower(email)=lower(p_verified_email) and status<>'rejected' and public.nanny_agreement_is_current(id) and (user_id is null or user_id=p_actor) order by created_at desc for update loop
  if exists(select 1 from public.nannies where application_id=a.id and user_id is not null and user_id<>p_actor) then continue; end if;
  if exists(select 1 from public.nannies where user_id=p_actor and application_id<>a.id) then continue; end if;
  update public.nanny_applications set user_id=p_actor where id=a.id;
  update public.nannies set user_id=p_actor where application_id=a.id and user_id is null;
  linked=linked+1;
 end loop;
 if linked>0 then update public.profiles set role='nanny' where id=p_actor and role<>'admin'; end if;
 return linked;
end $$;

create or replace function public.review_nanny_application(p_id uuid,p_actor uuid,p_changes jsonb,p_notify_interview boolean default false) returns void language plpgsql set search_path=public as $$
declare a public.nanny_applications; old_status public.application_status; check_name text;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise insufficient_privilege; end if;
 select * into a from public.nanny_applications where id=p_id for update;
 if not found then raise exception 'Application not found.'; end if;
 old_status=a.status;
 a=jsonb_populate_record(a,p_changes);
 if a.status='approved' then
  if not public.nanny_agreement_is_current(a.id) then raise exception 'The nanny must accept the current agreement before approval.'; end if;
  foreach check_name in array array['identity','policeClearance','references','interview','qualifications'] loop
   if a.vetting_checks->>check_name is distinct from 'true' then raise exception 'Complete every verification check before approving.'; end if;
  end loop;
  if (select count(*) from public.nanny_references where application_id=a.id)<2 then raise exception 'Two references are required before approval.'; end if;
  if exists(select kind from unnest(array['photo','id_front','id_back','selfie','cogc']) kind where not exists(select 1 from public.nanny_documents d where d.application_id=a.id and d.kind::text=kind)) then raise exception 'Verify the complete identity and police clearance documents first.'; end if;
  a.vetting_reviewed_at=now();a.vetting_reviewed_by=p_actor;
  update public.ops_tasks set status='resolved',resolved_at=now(),assigned_to=p_actor where dedupe_key='document-review:'||a.id;
 end if;
 if a.status<>old_status then a.decision_version=a.decision_version+1; end if;
 if a.status='approved' and old_status<>'approved' then a.approval_email_sent_at=null; end if;
 update public.nanny_applications set decision_version=a.decision_version,approval_email_sent_at=a.approval_email_sent_at,status=a.status,admin_notes=a.admin_notes,interview_at=a.interview_at,estimated_tier=a.estimated_tier,vetting_checks=a.vetting_checks,vetting_reviewed_at=a.vetting_reviewed_at,vetting_reviewed_by=a.vetting_reviewed_by where id=p_id;
 if a.status='approved' and a.user_id is not null then update public.profiles set role='nanny' where id=a.user_id and role<>'admin'; end if;
 if old_status='approved' and a.status<>'approved' then update public.nannies set is_active=false,is_suspended=true,suspension_reason='Application approval withdrawn' where application_id=p_id; end if;
 if a.status in ('approved','rejected') and (a.status<>old_status or (a.status='approved' and a.approval_email_sent_at is null)) then
  perform public.enqueue_workflow_job('application_status',jsonb_build_object('applicationId',p_id,'status',a.status,'decisionVersion',a.decision_version),'application-status:'||p_id||':'||a.status||':'||a.decision_version);
 end if;
 if p_notify_interview and a.interview_at is not null then perform public.enqueue_workflow_job('application_interview',jsonb_build_object('applicationId',p_id,'interviewAt',a.interview_at),'interview:'||p_id||':'||a.interview_at); end if;
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action,details) values(p_actor,'application',p_id,'review',jsonb_build_object('previousStatus',old_status,'status',a.status,'checks',a.vetting_checks));
end $$;

create or replace function public.guard_nanny_publication() returns trigger language plpgsql set search_path=public as $$
begin
 if new.is_active and (tg_op='INSERT' or not old.is_active) then
  if not public.nanny_agreement_is_current(new.application_id) then raise exception 'The nanny must accept the current agreement before activation.'; end if;
  if not exists(select 1 from public.nanny_applications a where a.id=new.application_id and a.status='approved' and a.agreement_signed_path is not null and a.agreement_reviewed_at is not null and a.agreement_reviewed_by is not null) then raise exception 'Approve the application and review the signed agreement before publishing.'; end if;
  if not exists(select 1 from public.nanny_applications a where a.id=new.application_id and a.vetting_reviewed_at is not null and a.vetting_reviewed_by is not null and a.vetting_checks @> '{"identity":true,"policeClearance":true,"references":true,"interview":true,"qualifications":true}') then raise exception 'Complete and record all verification checks before publishing.'; end if;
 end if;
 return new;
end $$;

create or replace function public.record_nanny_agreement(p_id uuid,p_actor uuid,p_path text) returns void language plpgsql set search_path=public as $$
declare a public.nanny_applications;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise insufficient_privilege; end if;
 select * into a from public.nanny_applications where id=p_id for update;
 if not found or a.status<>'approved' then raise exception 'Approve the application before recording its signed agreement.'; end if;
 if not public.nanny_agreement_is_current(a.id) then raise exception 'The nanny must accept the current agreement before signed-document review.'; end if;
 if p_path like a.id::text||'/agreements/submitted-%' and a.agreement_submitted_path is distinct from p_path then raise exception 'The submitted agreement changed. Refresh before reviewing.'; end if;
 update public.nanny_applications set agreement_signed_path=p_path,agreement_reviewed_at=now(),agreement_reviewed_by=p_actor where id=p_id;
 update public.ops_tasks set status='resolved',resolved_at=now(),assigned_to=p_actor where dedupe_key='agreement-review:'||p_id;
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action) values(p_actor,'application',p_id,'agreement_reviewed');
end $$;
create function public.submit_nanny_signed_agreement(p_application uuid,p_actor uuid,p_path text) returns void language plpgsql set search_path='' as $$
declare a public.nanny_applications;
begin
 select * into a from public.nanny_applications where id=p_application for update;
 if not found or a.user_id is distinct from p_actor then raise insufficient_privilege; end if;
 if a.status<>'approved' or not public.nanny_agreement_is_current(a.id) then raise exception 'Approval and current agreement acceptance are required.'; end if;
 if a.agreement_reviewed_at is not null then raise exception 'Contact the team before replacing a reviewed agreement.'; end if;
 if p_path not like a.id::text||'/agreements/%' then raise exception 'Invalid agreement file.'; end if;
 update public.nanny_applications set agreement_submitted_path=p_path,agreement_submitted_at=now() where id=a.id;
 insert into public.ops_tasks(dedupe_key,kind,summary) values('agreement-review:'||a.id,'agreement_review','A signed nanny agreement is ready for document review.') on conflict(dedupe_key) do update set status='open',resolved_at=null;
 perform public.enqueue_workflow_job('ops_notice',jsonb_build_object('summary','A signed nanny agreement is ready for review in Applications.'),'agreement-submitted:'||p_path);
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action) values(p_actor,'application',a.id,'agreement_submitted');
end $$;

create function public.add_nanny_document(p_application uuid,p_actor uuid,p_document jsonb) returns void language plpgsql set search_path='' as $$
declare a public.nanny_applications; check_name text;
begin
 select * into a from public.nanny_applications where id=p_application for update;
 if not found or public.otp_email_user(a.email) is distinct from p_actor or (a.user_id is not null and a.user_id<>p_actor) then raise insufficient_privilege; end if;
 if a.status in('approved','rejected') then raise exception 'Contact the team before changing documents after a decision.'; end if;
 if p_document->>'kind' not in('photo','id_front','id_back','selfie','cogc','passport','certificate') or p_document->>'storage_path' not like 'nanny-documents/'||a.id::text||'/supplemental/%' then raise exception 'Invalid document.'; end if;
 insert into public.nanny_documents(application_id,kind,storage_path,file_name,mime_type) values(a.id,(p_document->>'kind')::public.document_kind,p_document->>'storage_path',p_document->>'file_name',p_document->>'mime_type');
 check_name=case p_document->>'kind' when 'cogc' then 'policeClearance' when 'certificate' then 'qualifications' else 'identity' end;
 update public.nanny_applications set vetting_checks=jsonb_set(coalesce(vetting_checks,'{}'),array[check_name],'false'),updated_at=now() where id=a.id;
 insert into public.ops_tasks(dedupe_key,kind,summary) values('document-review:'||a.id,'document_review','New nanny verification documents need review before approval.') on conflict(dedupe_key) do update set status='open',resolved_at=null;
 perform public.enqueue_workflow_job('ops_notice',jsonb_build_object('summary','New nanny verification documents need review in Applications.'),'nanny-document:'||(p_document->>'storage_path'));
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action,details) values(p_actor,'application',a.id,'document_added',jsonb_build_object('kind',p_document->>'kind'));
end $$;

-- No browser role can fabricate acceptance, grant a nanny role or review a signature.
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('add_nanny_document','submit_nanny_signed_agreement','nanny_agreement_is_current','nanny_signup_application','accept_nanny_agreement','save_complete_application','claim_nanny_applications','review_nanny_application','guard_nanny_publication','record_nanny_agreement') loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
