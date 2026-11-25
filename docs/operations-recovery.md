# Onboarding, coverage and recovery

The November 25 release publishes the nine areas confirmed by the owner: Nairobi, Naivasha, Nakuru, Mombasa, Diani, Malindi, Watamu, Maasai Mara and Nanyuki. Publishing an area does not assert that a particular nanny serves it. Availability and individual coverage still need confirmation.

## Existing nanny accounts

Migration `20261125171933_existing_nanny_onboarding_and_operations_health.sql` links an existing nanny and Auth identity to a draft application, without creating another account or inventing agreement acceptance. Administrators can open the linked record from Nannies. The nanny follows **Complete my existing nanny onboarding** in their portal, supplies legal details, references and private documents, and accepts the current agreement themselves. Their verified account email is fixed. Owner checks and transactional submission prevent an administrator from accepting on their behalf or a retry from duplicating the submission.

Existing profiles retain their identity and booking history. No service areas, biographies, photos or acceptance records are invented. The team must arrange completion and review these records. Existing active profiles remain active during this transition; they have not been retrospectively marked vetted. Subsequent approval and activation still require the agreement, vetting and signed/witnessed PDF checks. Reviewed profile details update the original profile.

## Forms and readiness

Browser form requests have a 30-second deadline, retain current form state on transport failures and release their busy controls. A timeout can have an uncertain save result; the message asks the user to check the saved state before retrying. Sensitive payout details and file bytes remain outside browser draft storage. Existing onboarding contact drafts use an application-specific key.

`/api/health/live` checks that the application responds. `/api/health` returns 503 if the database, recent worker heartbeat, queue or email configuration is unhealthy. Email configuration does not prove inbox delivery. `/api/operations/health` requires `MONITOR_SECRET` and provides queue diagnostics to the independent monitor. None of these endpoints returns customer records.

## Independent alerts

`.github/workflows/operations.yml` runs outside the application queue every five minutes, using `MONITOR_SECRET`. It checks the protected readiness endpoint and the freshness of encrypted backup artifacts. It alerts operations directly through SMTP for a new incident, changed failure reason or an ongoing hourly failure; it also reports recovery. Cached state limits repeat notices. An SMTP outcome can still be uncertain, so it is not an exactly-once delivery guarantee. GitHub schedules can be delayed and require an active repository; they are not a strict five-minute SLA.

The workflow runs only in the repository selected by `OPERATIONS_REPOSITORY`. Alert address is set through `OPERATIONS_ALERT_EMAIL`. SMTP authentication can be checked through manual dispatch with `verify_mail=true`, without a test message. The database queue worker remains minute-level Supabase Cron with its Vercel fallback.

## Encrypted complete backups

`.github/workflows/backup.yml` runs daily at 02:17 UTC / 05:17 EAT. It exports schema, table data, roles, Auth records, Storage metadata and actual file bytes, Auth configuration and migration history. It also escrows the application encryption key and the scheduler's two Vault values inside the encrypted archive. Production provider credentials and hosting configuration remain separately managed in their services and must be supplied during a rebuild.

The archive uses AES-256-GCM with a separate recovery key and authenticated encryption. File checksums and a stable Storage inventory are checked before publication. The database data export is a pg_dump snapshot; cross-service writes during a backup can require application-level reconciliation. A changed Storage inventory makes the backup fail. Only encrypted `.vnbak` files and their checksums are uploaded to GitHub artifacts, retained for 30 days. The monitor flags a missing successful artifact older than 27 hours.

Required workflow secrets are `BACKUP_SUPABASE_ACCESS_TOKEN`, `BACKUP_SUPABASE_SERVICE_ROLE_KEY`, `BACKUP_ENCRYPTION_KEY` and `BACKUP_APP_ENCRYPTION_KEY`. The management token needs the documented CLI temporary-login and metadata permissions. No database password is reset. Keep the application encryption key stable so existing queued payloads and private agreement details remain readable.

The recovery key has a separate device escrow at `/home/alex/.local/share/vacaynanny/backup-recovery-key` with owner-only permissions. Keep an additional private offline copy: GitHub secrets cannot be read back through the API. Do not commit it or send it in chat.

To check an archive, start the isolated local Supabase stack and run:

```sh
npm run db:restore:check -- --archive=/private/path/backup.vnbak --local
```

Supply `BACKUP_ENCRYPTION_KEY` privately, or use the device escrow. The verifier creates a separate temporary database, restores schema and data with triggers disabled for that session, compares every archived table count, and round-trips Storage files through a temporary private bucket with SHA-256 comparison. It drops that database and bucket afterward. Auth and worker services never connect to the restored production identities, and production cron jobs/Vault credentials are not activated by this test.

A real disaster recovery operation requires a compatible Supabase project, restoring roles/schema/data and Storage objects, securely restoring runtime/provider configuration, reconnecting the domain, and checking authentication, payments and queue behavior before enabling workers. The verification command deliberately performs no production restore. Repeat an isolated restore check after material schema or backup changes.
