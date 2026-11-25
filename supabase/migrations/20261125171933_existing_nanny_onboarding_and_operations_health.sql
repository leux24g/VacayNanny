begin;
-- Destinations confirmed by the user on 25 November 2026.
insert into public.destinations(name,country,slug,image_url,description,is_active,sort_order) values
('Nairobi','Kenya','nairobi','/images/destinations/nairobi.webp','Request childcare in Nairobi. Availability is confirmed for your dates and family requirements.',true,0),
('Naivasha','Kenya','naivasha','/images/destinations/mara.webp','Request childcare in Naivasha. Availability is confirmed for your dates and family requirements.',true,1),
('Nakuru','Kenya','nakuru','/images/destinations/mara.webp','Request childcare in Nakuru. Availability is confirmed for your dates and family requirements.',true,2),
('Mombasa','Kenya','mombasa','/images/destinations/diani.webp','Request childcare in Mombasa. Availability is confirmed for your dates and family requirements.',true,3),
('Diani','Kenya','diani','/images/destinations/diani.webp','Request childcare in Diani. Availability is confirmed for your dates and family requirements.',true,4),
('Malindi','Kenya','malindi','/images/destinations/watamu.webp','Request childcare in Malindi. Availability is confirmed for your dates and family requirements.',true,5),
('Watamu','Kenya','watamu','/images/destinations/watamu.webp','Request childcare in Watamu. Availability is confirmed for your dates and family requirements.',true,6),
('Maasai Mara','Kenya','maasai-mara','/images/destinations/mara.webp','Request childcare in Maasai Mara. Availability is confirmed for your dates and family requirements.',true,7),
('Nanyuki','Kenya','nanyuki','/images/destinations/mara.webp','Request childcare in Nanyuki. Availability is confirmed for your dates and family requirements.',true,8)
on conflict(slug) do nothing;
alter table public.nanny_applications add column legacy_nanny_id uuid unique references public.nannies(id);
alter table public.nanny_applications add column legacy_completed_at timestamptz;

-- Existing users get a draft record, never fabricated acceptance or vetting.
do $$ declare n record; a uuid; begin
 for n in select p.*,u.email canonical_email,coalesce(f.phone,'') contact_phone from public.nannies p join auth.users u on u.id=p.user_id left join public.profiles f on f.id=p.user_id where p.application_id is null loop
  a=gen_random_uuid();
  insert into public.nanny_applications(id,user_id,legacy_nanny_id,full_name,email,phone,county,town,languages,age_groups,services,certifications,available_days,preferred_locations,estimated_tier,status,bio)
  values(a,n.user_id,n.id,n.display_name,n.canonical_email,n.contact_phone,n.county,n.town,n.languages,n.age_groups,n.services,n.certifications,n.available_days,n.destinations,n.tier,'pending',n.bio);
  update public.nannies set application_id=a where id=n.id;
  insert into public.ops_tasks(dedupe_key,kind,summary) values('legacy-onboarding:'||n.id,'legacy_onboarding','An existing nanny needs to complete legal details, references, documents and current agreement acceptance. Review the linked application; do not create a second account or profile.') on conflict do nothing;
  insert into public.workflow_audit(entity_type,entity_id,action) values('application',a,'existing_profile_linked_for_onboarding');
 end loop;
end $$;

create function public.begin_existing_onboarding(p_nanny uuid,p_actor uuid,p_email text) returns uuid language plpgsql set search_path='' as $$
declare n public.nannies; a uuid;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='admin') then raise insufficient_privilege; end if;
 select * into n from public.nannies where id=p_nanny for update;
 if not found or n.user_id is null or public.otp_email_user(p_email) is distinct from n.user_id then raise exception 'Link the nanny to its canonical verified account first.'; end if;
 if n.application_id is not null then return n.application_id; end if;
 a=gen_random_uuid();
 insert into public.nanny_applications(id,user_id,legacy_nanny_id,full_name,email,county,town,languages,age_groups,services,certifications,available_days,preferred_locations,estimated_tier,status,bio) values(a,n.user_id,n.id,n.display_name,lower(p_email),n.county,n.town,n.languages,n.age_groups,n.services,n.certifications,n.available_days,n.destinations,n.tier,'pending',n.bio);
 update public.nannies set application_id=a where id=n.id;
 insert into public.ops_tasks(dedupe_key,kind,summary) values('legacy-onboarding:'||n.id,'legacy_onboarding','An existing nanny needs to complete and verify their linked onboarding record.') on conflict do nothing;
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action) values(p_actor,'application',a,'existing_profile_linked_for_onboarding');
 return a;
end $$;
revoke execute on function public.begin_existing_onboarding(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_existing_onboarding(uuid,uuid,text) to service_role;

create function public.complete_existing_application(p_id uuid,p_actor uuid,p_row jsonb,p_references jsonb,p_documents jsonb) returns jsonb language plpgsql set search_path='' as $$
declare a public.nanny_applications; fresh public.nanny_applications; item jsonb; acceptance jsonb=p_row->'agreement_acceptance';
begin
 select * into a from public.nanny_applications where id=p_id for update;
 if not found or a.legacy_nanny_id is null or a.user_id is distinct from p_actor or public.otp_email_user(a.email) is distinct from p_actor or lower(a.email) is distinct from lower(p_row->>'email') then raise insufficient_privilege; end if;
 if a.legacy_completed_at is not null then
  if a.submission_key=(p_row->>'submission_key')::uuid then return jsonb_build_object('id',a.id); end if;
  raise exception 'Your complete onboarding has already been submitted. Contact the team for corrections.';
 end if;
 if a.status='rejected' then raise exception 'Contact the team about this application decision.'; end if;
 if not coalesce((p_row->>'consent_background')::boolean,false) or not coalesce((p_row->>'consent_terms')::boolean,false) or not coalesce((p_row->>'consent_accuracy')::boolean,false) then raise exception 'All consents are required.'; end if;
 if nullif(trim(p_row->>'national_id_number'),'') is null or nullif(trim(p_row->>'phone'),'') is null or nullif(trim(p_row->>'full_name'),'') is null or p_row->>'date_of_birth' is null or (p_row->>'date_of_birth')::date > current_date-interval '21 years' then raise exception 'Complete your legal details and valid adult date of birth.'; end if;
 if acceptance->>'version' is distinct from '2026-11-24-revised' or acceptance->>'document_sha256' is distinct from '9eb913dbb9d462385a60abf97ddb478dc48f13519aab258ae78d4257ba98fc71' or lower(regexp_replace(trim(acceptance->>'signer_name'),'\s+',' ','g')) is distinct from lower(regexp_replace(trim(p_row->>'full_name'),'\s+',' ','g')) then raise exception 'Read and accept the current agreement using your legal name.'; end if;
 if jsonb_array_length(p_references)<>2 then raise exception 'Two references are required.'; end if;
 if exists(select kind from unnest(array['photo','id_front','id_back','selfie']) kind where not exists(select 1 from jsonb_array_elements(p_documents) d where d->>'kind'=kind)) then raise exception 'Required identity documents are missing.'; end if;
 if exists(select 1 from jsonb_array_elements(p_documents) d where d->>'storage_path' not like 'nanny-documents/'||a.id::text||'/%') then raise exception 'Invalid document ownership.'; end if;
 fresh=jsonb_populate_record(a,p_row);
 update public.nanny_applications set full_name=fresh.full_name,
 date_of_birth=fresh.date_of_birth,
 phone=fresh.phone,
 country_code=fresh.country_code,
 gender=fresh.gender,
 languages=fresh.languages,
 county=fresh.county,
 town=fresh.town,
 national_id_number=fresh.national_id_number,
 kra_pin=fresh.kra_pin,
 cogc_status=fresh.cogc_status,
 cogc_date=fresh.cogc_date,
 experience_years=fresh.experience_years,
 age_groups=fresh.age_groups,
 services=fresh.services,
 bio=fresh.bio,
 certifications=fresh.certifications,
 swimming=fresh.swimming,
 cooking=fresh.cooking,
 tutoring=fresh.tutoring,
 driving=fresh.driving,
 special_needs=fresh.special_needs,
 available_days=fresh.available_days,
 earliest_start=fresh.earliest_start,
 latest_end=fresh.latest_end,
 willing_to_travel=fresh.willing_to_travel,
 preferred_locations=fresh.preferred_locations,
 comfortable_pets=fresh.comfortable_pets,
 comfortable_multiple=fresh.comfortable_multiple,
 estimated_tier=fresh.estimated_tier,
 consent_background=fresh.consent_background,
 consent_terms=fresh.consent_terms,
 consent_accuracy=fresh.consent_accuracy,
 submission_key=fresh.submission_key,legacy_completed_at=now(),status='pending',vetting_checks='{}',vetting_reviewed_at=null,vetting_reviewed_by=null,updated_at=now() where id=a.id;
 delete from public.nanny_references where application_id=a.id;
 for item in select value from jsonb_array_elements(p_references) loop
  insert into public.nanny_references(application_id,full_name,relationship,employer,phone,email,country_code,permission_to_contact,sort_order) values(a.id,item->>'full_name',item->>'relationship',item->>'employer',item->>'phone',item->>'email',item->>'country_code',item->>'permission_to_contact',(item->>'sort_order')::integer);
 end loop;
 for item in select value from jsonb_array_elements(p_documents) loop
  insert into public.nanny_documents(application_id,kind,storage_path,file_name,mime_type) values(a.id,(item->>'kind')::public.document_kind,item->>'storage_path',item->>'file_name',item->>'mime_type');
 end loop;
 insert into public.nanny_agreement_acceptances(application_id,version,document_sha256,signer_name,details) values(a.id,acceptance->>'version',acceptance->>'document_sha256',acceptance->>'signer_name',acceptance->'details');
 perform public.enqueue_workflow_job('application_received',jsonb_build_object('applicationId',a.id),'existing-application-received:'||a.id);
 insert into public.workflow_audit(actor_id,entity_type,entity_id,action) values(p_actor,'application',a.id,'existing_onboarding_completed');
 return jsonb_build_object('id',a.id);
end $$;

-- Private readiness data is consumed by a separate external watchdog, not the queue.
create function public.operations_health() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('database',true,'queue',public.workflow_queue_health(),'workerObserved',exists(select 1 from public.workflow_worker_runs));
$$;
revoke execute on function public.complete_existing_application(uuid,uuid,jsonb,jsonb,jsonb),public.operations_health() from public,anon,authenticated;
grant execute on function public.complete_existing_application(uuid,uuid,jsonb,jsonb,jsonb),public.operations_health() to service_role;
commit;
