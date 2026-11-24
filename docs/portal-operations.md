# Portal and agreement operations

The client portal at `/account` brings together current and historical trips, booking messages, payment status and downloadable payment records, specialist care enquiries and quote acceptance, contact details and support/security links. Payment records are an acknowledgement of verified payment, not tax invoices. Clients can access only their own private records.

The nanny portal at `/nanny` shows application progress, agreement acceptance and private documents, signed-agreement submission, profile and availability, assignments and messages, completion reports, payout terms and published feedback. Unpublished applicants can follow onboarding without gaining access to family bookings. Pending applicants can add verification documents; these reset the relevant vetting check and create an administrator follow-up. Decided applications require team intervention before document replacement.

The administrator portal at `/admin` retains its twelve operations panels and adds agreement evidence, private payout detail access, completion reports and queue monitoring. Follow-ups must be reviewed and resolved by an operator; marking a payout review resolved does not send money.

## Supplied agreement

The controlling template for this release is the user's revised 16-page PDF, published byte-for-byte at `/documents/vacaynanny-nanny-agreement-2026-11-24.pdf`, with a readable text view at `/nanny-agreement`. Version: `2026-11-24-revised`. SHA-256: `9eb913dbb9d462385a60abf97ddb478dc48f13519aab258ae78d4257ba98fc71`.

Applications require legal name, identity/contact details, private payout details and an explicit unticked-by-default statement of reading, understanding and acceptance. Server validation occurs before uploads and before nanny signup. New Auth accounts are created only after email verification. Acceptance evidence is versioned and private; payout details are encrypted, masked in the nanny view and revealed only to administrators. Payout details and file bytes are not saved in browser draft storage. Contact details are kept in the current browser tab; other answers and files must be supplied again after refreshing.

Online acceptance permits account onboarding. Administrator vetting and a completed, signed and witnessed PDF remain required before activation for family bookings. The original template is also stored in private `nanny-documents/templates/nanny-agreement-2026-11-24.pdf`; production `NANNY_AGREEMENT_STORAGE_PATH` points to it for approval mail attachments. The earlier generated draft is superseded for onboarding.

The supplied commission rates are Bronze 22.73%, Silver 21.88% and Gold 21.15%. Payout is due within three business days after the completed form and client sign-off are received and checked, subject to the agreement. The portals explain these terms. Existing family booking totals are not presented as nanny wallet balances. Deductions, refunds and transfers remain manual; no automatic payout has been introduced.

Before requesting the family confirmation code, each nanny submits actual hours, a work/handover summary and agreed additional-service or expense notes. Changes invalidate existing codes. The family can inspect the report; each assignment needs its own confirmation. Confirmed reports create a payout-review follow-up for operations. Notes do not add charges automatically.

## Queue operation

Authoritative account and booking changes commit immediately through protected APIs. Notifications and file cleanup use the durable database outbox. Application saves, decisions, document submissions, completion confirmation and their follow-up work commit together in database transactions. Browser requests receive meaningful errors and retain unsaved form values on recoverable failures.

Minute-level Supabase Cron and the daily Vercel fallback call the protected worker. It claims one job when it is ready to start, uses a bounded invocation budget and per-job/provider deadlines, and records worker runs. A three-minute expired lease becomes eligible for recovery. Transient failures back off, up to eight attempts including interrupted workers, then become failed jobs with an operations follow-up. Jobs are not retried indefinitely.

The email delivery journal records delivery start and provider acceptance. Accepted emails resume bookkeeping without another send. An interrupted SMTP send with an unknown result requires an operator to inspect provider logs and confirm non-delivery before resend. SMTP Message-ID alone cannot guarantee deduplication. Resend retries use a stable idempotency key and stop for review once the safe retry window expires. OTPs are delivered immediately with request deadlines because authentication needs the result in the current request.

Private upload cleanup runs after three hours and checks application/document references before deletion. Public photo cleanup checks all catalog/profile references and retains files still in use. The administrator Follow-ups panel exposes queue counts, expired leases, failed jobs and recent worker status. A failed job needs attention; it is not described as successful processing.

## Release checks

The coordinated schema additions are `20261124163614_nanny_agreement_acceptance.sql`, `20261124164634_bounded_queue_workers.sql` and `20261124165435_care_completion_reports.sql`. Apply them after the existing payment/workflow/auth release. Do not replay the earlier production bundles.

Regression coverage includes agreement-gated account creation, immutable private acceptance evidence, document review, ownership checks, report/code invalidation, retry exhaustion, lease recovery, uncertain SMTP delivery and referenced-photo retention. Public imagery is still, with an error fallback and no Pause control. Browser checks include the public site and all three portals at phone, tablet and desktop widths. Live smoke checks do not send customer test emails or charge live cards.
