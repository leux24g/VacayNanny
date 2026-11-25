begin;
-- Qualification is a ceiling, not an exact work-category match.
create function public.nanny_qualifies_for_work(p_nanny uuid,p_tier text) returns boolean language sql stable set search_path='' as $$
 select coalesce((select
  case when n.tier='gold' and n.safeguarding_completed_at is not null then 3 when n.tier in('silver','gold') then 2 else 1 end >=
  case lower(coalesce(p_tier,'')) when '' then 0 when 'bronze' then 1 when 'standard' then 1 when 'basic' then 1 when 'silver' then 2 when 'pro' then 2 when 'professional' then 2 when 'gold' then 3 when 'elite' then 3 else 99 end
 from public.nannies n where n.id=p_nanny),false);
$$;
create function public.guard_assignment_work_tier() returns trigger language plpgsql set search_path='' as $$
declare category text;
begin
 select tier into category from public.bookings where id=new.booking_id for update;
 perform 1 from public.nannies where id=new.nanny_id for share;
 if not public.nanny_qualifies_for_work(new.nanny_id,category) then raise exception 'This nanny does not qualify for the booked care category.'; end if;
 return new;
end $$;
create trigger guard_assignment_work_tier before insert or update of nanny_id,booking_id,response on public.booking_assignments for each row execute function public.guard_assignment_work_tier();
create function public.guard_booking_work_tier() returns trigger language plpgsql set search_path='' as $$
begin
 -- Assigning a higher-qualified nanny must not silently change a family's category.
 if tg_op='UPDATE' and nullif(old.tier,'') is not null and new.tier is distinct from old.tier then raise exception 'Keep the agreed booking category. Create a new request to change care categories.'; end if;
 if new.status not in('cancelled','completed') then
  if new.nanny_id is not null and not public.nanny_qualifies_for_work(new.nanny_id,new.tier) then raise exception 'This nanny does not qualify for the booked care category.'; end if;
  if tg_op='UPDATE' and exists(select 1 from public.booking_assignments a where a.booking_id=new.id and (a.slot<>1 or a.nanny_id=new.nanny_id) and not public.nanny_qualifies_for_work(a.nanny_id,new.tier)) then raise exception 'Every nanny must qualify for the booked care category.'; end if;
 end if;
 return new;
end $$;
create trigger guard_booking_work_tier before insert or update of tier,nanny_id,check_in,check_out,status on public.bookings for each row execute function public.guard_booking_work_tier();

-- Photo pointer, retired-photo cleanup and audit commit together. New uploads have
-- an independent delayed cleanup job before bytes reach Storage.
create function public.update_nanny_photo(p_nanny uuid,p_actor uuid,p_photo_url text) returns text language plpgsql set search_path='' as $$
declare n public.nannies; administrator boolean;
begin
 select * into n from public.nannies where id=p_nanny for update;
 if not found then raise exception 'Nanny profile not found.'; end if;
 administrator=exists(select 1 from public.profiles where id=p_actor and role='admin');
 if not administrator and (n.user_id is distinct from p_actor or n.is_suspended) then raise insufficient_privilege; end if;
 if p_photo_url is not null and p_photo_url not like 'https://%/storage/v1/object/public/nanny-photos/live/'||n.id::text||'/%' and p_photo_url not like 'http://127.0.0.1:%/storage/v1/object/public/nanny-photos/live/'||n.id::text||'/%' then raise exception 'Invalid photo storage path.'; end if;
 if n.photo_url is not distinct from p_photo_url then return p_photo_url; end if;
 update public.nannies set photo_url=p_photo_url where id=n.id;
 if n.photo_url is not null then perform public.enqueue_workflow_job('public_photo_cleanup',jsonb_build_object('url',n.photo_url),'photo-retire:'||md5(n.photo_url)); end if;
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action) values(p_actor,'nanny',n.id,case when p_photo_url is null then 'photo_removed' else 'photo_updated' end);
 return p_photo_url;
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname in('nanny_qualifies_for_work','guard_assignment_work_tier','guard_booking_work_tier','update_nanny_photo') loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
