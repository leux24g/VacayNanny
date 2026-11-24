begin;
alter table public.workflow_jobs add column delivery_started_at timestamptz;
alter table public.workflow_jobs add column delivery_accepted_at timestamptz;
create or replace function public.enqueue_workflow_job(p_kind text,p_payload jsonb,p_key text) returns uuid
language plpgsql set search_path=public as $$
declare result uuid;
begin
 insert into public.workflow_jobs(kind,payload,dedupe_key,available_at) values(p_kind,p_payload,p_key,case when p_kind in('application_upload_cleanup','public_photo_cleanup') then now()+interval '3 hours' else now() end)
 on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key returning id into result;
 return result;
end $$;

create table public.workflow_worker_runs (
 id uuid primary key default gen_random_uuid(), started_at timestamptz not null default now(),
 finished_at timestamptz, status text not null default 'running' check(status in('running','completed','failed')),
 processed integer not null default 0, failed integer not null default 0, last_error text
);
alter table public.workflow_worker_runs enable row level security;
revoke all on public.workflow_worker_runs from public,anon,authenticated;
grant all on public.workflow_worker_runs to service_role;

create or replace function public.claim_workflow_jobs(p_limit integer default 30,p_kinds text[] default null) returns setof public.workflow_jobs language plpgsql set search_path='' as $$
begin
 -- A worker that repeatedly dies must eventually surface for review too.
 with exhausted as (
  update public.workflow_jobs set status='failed',lease_token=null,locked_at=null,last_error='Worker interrupted repeatedly. Review before retrying.'
  where attempts>=8 and ((status='processing' and (locked_at is null or locked_at<now()-interval '3 minutes')) or status='pending') returning id
 ) insert into public.ops_tasks(dedupe_key,kind,summary)
 select 'notification:'||id,'notification_failed','A repeatedly interrupted job needs review and retry.' from exhausted
 on conflict(dedupe_key) do update set status='open',resolved_at=null;
 return query update public.workflow_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),lease_token=gen_random_uuid()
 where j.id in(select id from public.workflow_jobs where attempts<8 and ((status='pending' and available_at<=now()) or (status='processing' and (locked_at is null or locked_at<now()-interval '3 minutes')))
 and (p_kinds is null or kind=any(p_kinds)) order by available_at,created_at for update skip locked limit greatest(0,least(coalesce(p_limit,1),100))) returning j.*;
 delete from public.workflow_worker_runs where started_at<now()-interval '7 days';
end $$;

create or replace function public.finish_workflow_job(p_id uuid,p_lease uuid,p_error text default null) returns void language plpgsql set search_path='' as $$
declare j public.workflow_jobs; terminal boolean;
begin
 select * into j from public.workflow_jobs where id=p_id and lease_token=p_lease and status='processing' for update;
 if not found then return; end if;
 terminal = p_error is not null and (j.attempts>=8 or p_error like 'Manual delivery check required:%');
 update public.workflow_jobs set status=case when p_error is null then 'completed' when terminal then 'failed' else 'pending' end,
 completed_at=case when p_error is null then now() else null end,last_error=left(p_error,500),lease_token=null,locked_at=null,
 delivery_started_at=case when p_error like 'Delivery not started:%' and delivery_accepted_at is null then null else delivery_started_at end,
 available_at=now()+make_interval(secs=>least(3600,30*power(2,least(j.attempts,7))::integer)) where id=p_id;
 if terminal then
  insert into public.ops_tasks(dedupe_key,kind,summary) values('notification:'||j.id,'notification_failed','A job needs review. Check delivery before retrying.') on conflict(dedupe_key) do update set status='open',resolved_at=null;
 elsif p_error is null then update public.ops_tasks set status='resolved',resolved_at=now() where dedupe_key='notification:'||j.id;
 end if;
end $$;

create function public.retry_workflow_job(p_id uuid,p_actor uuid,p_confirmed_not_delivered boolean default false) returns void language plpgsql set search_path='' as $$
declare job public.workflow_jobs;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise insufficient_privilege; end if;
 select * into job from public.workflow_jobs where id=p_id and status='failed' for update;
 if not found then raise exception 'Only a failed job can be retried.'; end if;
 if job.delivery_started_at is not null and job.delivery_accepted_at is null and not p_confirmed_not_delivered then raise exception 'Check provider delivery before resending an uncertain email.'; end if;
 update public.workflow_jobs set status='pending',attempts=0,available_at=now(),last_error=null,lease_token=null,locked_at=null,completed_at=null,delivery_started_at=case when delivery_accepted_at is null then null else delivery_started_at end where id=p_id and status='failed';
 if not found then raise exception 'Only a failed job can be retried.'; end if;
 update public.ops_tasks set status='acknowledged',assigned_to=p_actor,resolved_at=null where dedupe_key='notification:'||p_id;
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action) values(p_actor,'notification',p_id,'retry');
end $$;

-- A delivery journal prevents an interrupted SMTP worker from blindly sending again.
create function public.begin_workflow_email_delivery(p_id uuid,p_lease uuid) returns boolean language plpgsql set search_path='' as $$
declare job public.workflow_jobs;
begin
 select * into job from public.workflow_jobs where id=p_id and lease_token=p_lease and status='processing' and kind='email' for update;
 if not found then raise exception 'The email job lease changed.'; end if;
 if job.delivery_accepted_at is not null then return false; end if;
 update public.workflow_jobs set delivery_started_at=coalesce(delivery_started_at,now()) where id=p_id;
 return true;
end $$;
create function public.confirm_workflow_email_delivery(p_id uuid,p_lease uuid) returns void language plpgsql set search_path='' as $$
begin
 update public.workflow_jobs set delivery_accepted_at=coalesce(delivery_accepted_at,now()) where id=p_id and lease_token=p_lease and status='processing' and kind='email';
 if not found then raise exception 'The email job lease changed.'; end if;
end $$;

create function public.workflow_queue_health() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
  'ready',(select count(*) from public.workflow_jobs where status='pending' and available_at<=now()),
  'scheduled',(select count(*) from public.workflow_jobs where status='pending' and available_at>now()),
  'processing',(select count(*) from public.workflow_jobs where status='processing'),
  'stale',(select count(*) from public.workflow_jobs where status='processing' and (locked_at is null or locked_at<now()-interval '3 minutes')),
  'failed',(select count(*) from public.workflow_jobs where status='failed'),
  'oldestReadyAt',(select min(available_at) from public.workflow_jobs where status='pending' and available_at<=now()),
  'workerStale',coalesce((select started_at<now()-interval '3 minutes' from public.workflow_worker_runs order by started_at desc limit 1),false),
  'lastSuccessAt',(select max(finished_at) from public.workflow_worker_runs where status='completed'),
  'lastRun',(select jsonb_build_object('startedAt',started_at,'finishedAt',finished_at,'status',status,'processed',processed,'failed',failed,'error',last_error) from public.workflow_worker_runs order by started_at desc limit 1)
 );
$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('claim_workflow_jobs','finish_workflow_job','retry_workflow_job','workflow_queue_health','begin_workflow_email_delivery','confirm_workflow_email_delivery') loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
