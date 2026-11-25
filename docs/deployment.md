# VacayNanny on Vercel

The refreshed application is live at `https://www.vacaynanny.net` on the existing Vercel project `vacaynanny/vacay-nanny`. Production deployment `dpl_AXWmdpofS8jEyZqJ4RCzN4c4Tdn7` contains application commit `950aa5c34cfd48ec0777345a0dc76c582b3962ff`. The pricing cards use metallic Bronze/Silver/Gold colours with brief shimmer/shiver feedback and reduced-motion support. The release also includes existing-account nanny onboarding, nine confirmed destinations, bounded browser requests, dependency readiness and encrypted recovery/independent monitoring. It retains JPEG/PNG camera/upload controls, hierarchical work eligibility and all three portals; see [operations and recovery](operations-recovery.md) and [portal operations](portal-operations.md). Database migrations, production SMTP/Paystack configuration, Auth origins and the minute-level workflow scheduler were applied on 24 November 2026. See [release verification and remaining dependencies](database-readiness.md).

The release was uploaded directly with authorized project-scoped Vercel access. [PR #15](https://github.com/vacaynanny/VacayNanny/pull/15) contains the source but still needs an upstream maintainer merge; the available GitHub account cannot merge into the upstream repository. A successful manual release does not resolve the Git integration's team authorization check. Avoid redeploying the older `main` branch over this release.

## Review locally

```sh
nvm use
npm ci
npm run setup:local
npm run setup:check
npm run email:preview
npm run dev:review
```

Review the public site at `http://localhost:3101`. Sign in to `/login?next=/admin` with `operator@example.test`, password `local-review`, then its emailed verification code. This fixture server binds to `127.0.0.1`, uses dummy keys and sample data, rejects application-data writes, captures synthetic email in a loopback-only SMTP sink, and disables payments. Read the sample account code at `http://127.0.0.1:4748/__otp?email=operator@example.test`. The sink never forwards mail. It is never used by `npm run build` or a deployed app. `npm run dev` uses the configured database instead; use the review command for sample data, or the isolated database workflow below for real service integration.

Email previews are saved under `artifacts/email-previews/`. They use the supplied wording and a sample name. The revised agreement supplied by the user is the approval attachment; see [portal operations](portal-operations.md) for its version and hash.

## Nanny photos and work categories

See [photo editing and eligibility](photos-and-tier-eligibility.md) for the self-service and admin controls, camera fallback, privacy and queued cleanup, Gold safeguarding requirement, and category/price preservation. The new schema is applied after the portal release as `20261125151144_tier_eligibility_and_nanny_photos.sql`.

## Environment settings

The user selected the existing Supabase project for production. UAT requires its own test database and stable HTTPS origin; these have not been provisioned by this local work. Keep Vercel Preview and Production environment settings separate. The local Docker stack provides pre-release database validation. Do not run sandbox payments against the production database: a test-mode success can otherwise be mistaken for payment of a real booking.

| Variable                                                    | Preview / staging                                                 | Production                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`                                      | Stable staging HTTPS origin                                       | `https://www.vacaynanny.net`                                                  |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dedicated UAT database; local stack for local checks         | Existing production project                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`                                 | Corresponding server-only key                                     | Production server-only key                                                    |
| `EMAIL_DELIVERY_MODE`                                       | `disabled`; explicitly enable for controlled delivery checks      | `send` after sender verification                                              |
| `EMAIL_PROVIDER`, `EMAIL`, `EMAIL_APP_PASSWORD` | `smtp` with test mailbox credentials | `smtp` with the intended private sending credentials |
| `RESEND_API_KEY`                                            | Test sender key if checking delivery                              | Key for verified domain                                                       |
| `RESEND_FROM_EMAIL`                                         | Verified staging sender                                           | `VacayNanny <noreply@vacaynanny.net>` after verification                      |
| `RESEND_REPLY_TO_EMAIL`                                     | Monitored staging inbox                                           | `hello@vacaynanny.net`                                                        |
| `PAYSTACK_MODE` | `uat` | `prod` |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`, `PAYSTACK_WEBHOOK_SECRET` | Test-mode `sk_test_...`, `pk_test_...`, `whsec_...` | Never used by PROD mode |
| `PROD_PAYSTACK_SECRET_KEY`, `PROD_PAYSTACK_PUBLIC_KEY`, `PROD_PAYSTACK_WEBHOOK_SECRET` | Never used by UAT mode | Live-mode `sk_live_...`, `pk_live_...`, `whsec_...` |
| `NANNY_AGREEMENT_STORAGE_PATH`                              | Final blank PDF in the private bucket                             | Approved document's private path                                              |
| `NOTIFICATION_ENCRYPTION_KEY`                               | Stable server-only random key; preserve while testing queued jobs | Stable server-only random key; preserve for queued jobs/private enquiry links |
| `CRON_SECRET`                                               | Separate random value if manually testing                         | Separate random value, at least 32 characters                                 |

By default, the setup checker reports presence and formats without printing values, connecting to Supabase, sending mail or attempting a payment:

```sh
npm run setup:check -- --target=staging
npm run setup:check -- --target=production
```

Run these commands with the intended environment loaded. They deliberately exit unsuccessfully while required configuration or database schema verification remains outstanding. Add `--database` for read-only schema checks using the configured URL and server key; the default remains configuration-only. Schema checks select zero rows and inspect the API schema without invoking payment functions. A key with the right prefix is not proof of account capabilities or successful delivery.

Only variables beginning `NEXT_PUBLIC_` are intended for the browser. Never add that prefix to a service-role, payment, email or cron secret. Redeploy after changing Vercel environment variables so the deployment picks them up.

## Isolated local database

The Supabase CLI is pinned to 3.2.0. Docker must be running. These commands use a generated, unlinked workspace under `artifacts/supabase-local/` and never use the hosted project as a write target:

```sh
npm run db:start
npm run test:integration
npm run dev:database
npm run db:stop
```

The app uses port 3102; the API uses 56321, PostgreSQL uses 56322 and the local mail viewer uses 56324. The Docker network binds published services to loopback. Other Docker projects are left alone. Outgoing application email is disabled by default. To try the configured mailbox against local data, run `npm run dev:database -- --email`; messages are sent only when requested by that local app or its explicitly invoked workers. The app launcher accepts only a Paystack test key if one is configured, and overrides the project's Supabase values with the local credentials in memory.

`db:start` assembles the existing SQL sources into one generated bootstrap migration. It deliberately disables the legacy sample nanny seed, which contains invented ratings. `db:reset` rebuilds this disposable local database when SQL sources change. It removes local test data; it does not reset any hosted project. Stop local review processes before resetting. Starting an already running stack does not reapply changed SQL.

Integration tests create synthetic users through the actual Auth API, check policy helpers and role guards, upload a clearly labelled test document into private Storage, verify the agreement publication gate and exercise the payment functions through PostgREST. The local bootstrap includes final cutover so the complete enforced behavior is tested. Test payment settlement is simulated by the privileged database function; these tests do not establish merchant M-Pesa/card acceptance. The test document is never substituted for the official agreement PDF.

## Hosted database rollout

The existing project's pre-release 211 public-table columns matched the local baseline. Production now includes payment, agreement, workflow, OTP and per-session verification structures. The six release sources were applied atomically as migration `20261124153949_vacaynanny_payments_workflows_and_two_step_auth`; the scheduler was applied separately after deployment. Inspect migration history and schema before running these scripts again. Private application-data snapshots, a checksum, schema metadata and function definitions are saved under ignored `artifacts/`. The application-data export excludes Auth users and Storage file bytes and is not a transactionally consistent managed backup; no managed backups were listed for this project at that initial release. The November 25 release adds complete encrypted exports including Auth and Storage bytes, with an isolated production-archive restore check; see [operations and recovery](operations-recovery.md).

For this existing project, the preparatory application changes are `payments_and_agreements.sql` followed by `security_hardening.sql`; earlier schema/catalog/lifecycle objects are already present. Preparation keeps the old deployed API’s new bookings at `not_required` for its existing payment arrangement. The refreshed booking API explicitly saves `unpaid`. Apply `payment_cutover.sql` with the refreshed app after merchant setup and the approved agreement are ready: it changes the database default to `unpaid` and installs the signed-agreement publication trigger. The payment guard already prevents an explicitly unpaid booking from entering care. Preparation does not remove any already installed publication guard.

For a fresh project, compare the existing schema against the migrations. Do not rerun seed data blindly against an existing project. Test on staging in this order, skipping already applied migrations after confirming their schema:

1. `supabase/schema.sql`
2. `supabase/content_catalog.sql`
3. `supabase/booking_lifecycle.sql`
4. `supabase/messaging_and_automation.sql`
5. `supabase/payments_and_agreements.sql`
6. `supabase/security_hardening.sql`
7. `supabase/payment_cutover.sql` at the coordinated application/payment release
8. `supabase/migrations/20261119075620_workflow_integrity.sql` with the refreshed workflow application
9. `supabase/migrations/20261124050934_email_otps_and_care_completion.sql` with the OTP application release
10. `supabase/migrations/20261124053021_password_then_email_otp_sessions.sql` with the password-plus-code application release
11. `supabase/workflow_schedule.sql` after the refreshed endpoint and Vault settings are ready

`supabase/seed.sql` is optional sample/bootstrap data for a new development project. Existing bookings retain historical `not_required` payment status. Review their real balances separately. New bookings require payment after the family and nanny accept the match and before the date-only start boundary.

Verify policies, private storage access, new RPC permissions, application agreement fields and payment guards in staging. Upload the final blank agreement PDF to the private `nanny-documents` bucket and configure its path. Existing active nanny profiles are preserved; new profiles require approval and administrator review of the returned signed agreement before activation.

In each Supabase project's Authentication URL settings, set its corresponding Site URL and allow `/auth/callback` on that origin for existing links. Password recovery now uses `/forgot-password` and its emailed code; `/reset-password` redirects there. Enable email confirmation for password signup; verified-email guest booking/application claims deliberately reject automatically confirmed accounts that never proved ownership of the address. Create and verify the first administrator through the existing process, then have an authorized database operator set their role:

```sql
update public.profiles set role = 'admin' where email = 'the-authorized-admin@example.com';
```

## Payments and email

In Paystack, configure test and live modes separately. UAT uses `/api/payments/webhook/uat` and `/payments/return/uat` on the UAT deployment. Production uses `/api/payments/webhook/prod` and `/payments/return/prod` on the production deployment. UAT must use an isolated test database; using test keys against production bookings can create false payment records. Enable M-Pesa/mobile money and cards for the Kenyan merchant account. International Visa/Mastercard acceptance depends on merchant account approval. All booking charges use KES.

Production URLs are `https://www.vacaynanny.net/api/payments/webhook/prod` and `https://www.vacaynanny.net/payments/return/prod`. Set `NEXT_PUBLIC_SITE_URL` to each deployment's own origin; the server supplies its matching callback path. `PAYSTACK_MODE` defaults to `prod` on Vercel Production and `uat` elsewhere; set it explicitly in each deployment. There is no fallback between credential sets, incorrect test/live key prefixes fail before provider calls, and each deployment rejects the other mode's explicit routes. The webhook returns HTTP 404; a streamed Next.js callback response can start with HTTP 200 while rendering the not-found page. Provider verification also checks the transaction's `domain` (`test` versus `live`). The original unqualified URLs remain compatibility aliases for the selected mode.

The webhook signing variable is `PAYSTACK_WEBHOOK_SECRET` for UAT and `PROD_PAYSTACK_WEBHOOK_SECRET` for PROD, using the full `whsec_...` value from the matching Paystack mode. Once configured, only timestamped `Paystack-Signature` verification is accepted; legacy signatures do not bypass it. Local sandbox checks passed for M-Pesa, successful/declined cards and locally replayed webhooks. `npm run test:payments:sandbox` forces UAT and the isolated local database even when PROD keys are present. An enabled production endpoint subscribes to `charge.success`, and Paystack's signed production ping succeeded after deployment. The live app also rejected invalid signatures and the inactive UAT webhook. No live transaction was attempted. Cloudflare blocked the automated browser at Paystack's hosted payment form; the app's checkout initialization and redirect were verified, while completing that external form remains manual.

Complete test-mode M-Pesa and card payments, failure/cancellation, retries and duplicate/delayed webhooks against staging. Confirm strict reference, amount and currency verification, and check the payment ledger and booking state. Account-enabled international cards also need verification before launch. Refund execution and nanny payouts remain manual; the app records refund review status without claiming a transfer occurred.

Select SMTP or Resend and deliver both application templates to a controlled inbox. For SMTP, set `EMAIL_PROVIDER=smtp`, `EMAIL`, `EMAIL_APP_PASSWORD` and `EMAIL_DELIVERY_MODE=send`; Gmail uses `smtp.gmail.com:465` with TLS. Optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and `EMAIL_REPLY_TO` override those defaults. Gmail sends from the authenticated account. For Resend, select `EMAIL_PROVIDER=resend` and configure the existing verified domain/key. Run `npm run email:verify` to authenticate to SMTP without sending a message. Confirm the approval message carries the actual PDF, replies reach the monitored inbox, and the profile remains unpublished until the signed agreement has been reviewed.

## Booking scheduler

See [queue limits, delivery recovery and portal operations](portal-operations.md) for the new delivery journal, per-job deadlines, review requirements and file cleanup.

The checked-in daily schedule is `30 21 * * *` UTC, or **00:30 Africa/Nairobi**. Vercel cron runs against production deployments and supplies the `Authorization: Bearer <CRON_SECRET>` header when that variable is configured. URL query secrets are rejected.

The daily Vercel invocation is a fallback. Minute-level workflow processing uses Supabase Cron, so it does not depend on upgrading the Vercel plan. Before enabling `supabase/workflow_schedule.sql`, store the exact deployed HTTPS origin as `vacaynanny_site_url` and the matching server `CRON_SECRET` as `vacaynanny_cron_secret` in Supabase Vault. Keep both values server-side; do not put them in the SQL file, browser code, GitHub or chat. The script checks configuration and schedules separate minute jobs for deadline enforcement and authenticated notification processing. Run it only when the refreshed `/api/cron/workflows` endpoint is deployed. Applying schema alone does not enable the worker.

Verify both entries in `cron.job`, recent `cron.job_run_details`, and HTTP outcomes in `net._http_response`; successful submission of a pg_net request is not proof that the HTTP worker succeeded. Check the queue and Follow-ups panel as well. Lease expiry recovers interrupted work, failed jobs back off and surface after eight attempts, and retries reuse the provider idempotency key. A manual retry asks the operator to check delivery logs first. Disabled email mode leaves notifications queued, while abandoned-upload cleanup can still run. A failed lifecycle update does not prevent draining pending notifications.

Before migration, review existing active/hidden nanny profiles and booking overlaps. Existing active profiles are preserved; legacy hidden profiles require an operator restore. Conflicting legacy reservations and incomplete confirmations produce explicit operations tasks. No booking is deleted or silently treated as accepted. Complete verification evidence and signed-agreement review before restoring/publishing a profile. Changes to consent, dates and staffing now use the server workflow APIs; direct client writes remain denied.

References: [Supabase Cron with Vault and pg_net](https://supabase.com/docs/guides/functions/schedule-functions), [Vercel cron authentication and management](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [cron usage and plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Verification and rollout

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

For an isolated build, explicitly clear the Supabase URL and keys in the command environment. The GitHub Actions workflow already does this and uses only local fixtures for browser tests. A separate job starts the Docker stack and runs the real local integration suite. It requires no production secrets and saves review artifacts for seven days. A local test run does not confirm that the workflow has run on GitHub.

The 24 November production release passed platform builds and public/payment/worker smoke checks. The full functional suites used isolated local data: 60 unit tests, 36 database integration tests and 50 browser tests passed, together with lint and type checks. The supplied revised agreement is now configured. External inbox delivery, a separately provisioned UAT environment and live merchant acceptance remain separate checks.

## Earlier agreement draft (superseded)

The revised PDF supplied on 24 November 2026 supersedes this draft for onboarding, acceptance and approval attachments. Its commission and payout terms are documented in [portal operations](portal-operations.md). The generator below remains an editable historical draft tool.

The user requested creation of the nanny agreement and proposed commercial terms. The editable source is `docs/legal/nanny-agreement-draft.json`; `scripts/generate-agreement.py` renders PDF, DOCX and separate review notes under ignored `artifacts/agreements/`.

```sh
python3 -m venv --system-site-packages artifacts/agreement-tools
artifacts/agreement-tools/bin/pip install -r docs/legal/requirements.txt
artifacts/agreement-tools/bin/python scripts/generate-agreement.py
```

The draft proposes a 20% platform allocation within the family care charge, 80% nanny compensation, full approved-expense reimbursement and payout within two Kenyan business days after care, with weekly settlement for longer bookings. These proposals have not been implemented as fee deductions or automated payouts. Actual legal identity, address, verified insurance details and legal classification require completion and review. No registration details or insurance coverage have been fabricated. Do not configure the draft as the approval attachment; issue an approved version after review.

## Email verification and care completion — 24 November 2026

Sign-in verifies the existing password before sending an email code, and preserves that password after successful verification. Signup creates the Auth account and sets the chosen password only after email verification; nanny signup additionally requires an accepted application using the same verified address. Password recovery changes the password after an emailed code and then returns to sign-in without establishing a verified session. Unknown recovery addresses receive the same generic response without creating an account or sending mail. Incorrect sign-in credentials return the same error for unknown emails and wrong passwords. Signup choices never grant administrator or approved-nanny permissions.

The server generates six-digit codes, stores keyed hashes, encrypts internal Supabase token/session data, and delivers codes immediately through the selected provider. Codes expire after ten minutes, are single-use and allow five failed guesses. Resends wait one minute and replace earlier codes. Shared database rate limits fail closed. Browser responses contain neither codes nor Supabase session tokens; successful verification establishes the normal server-managed Auth cookies. The second migration records the verified Auth session in a private table and enforces that proof in protected routes and restrictive database/Storage policies. Password-only tokens cannot access private data even after that account completed an earlier OTP login. Apply both auth migrations with the matching app; the second invalidates pending passwordless challenges and requires existing users to sign in again.

Both OTP migrations are deployed with the application. The app delivers these codes directly through SMTP/Resend, so these flows do not require changing the hosted Supabase SMTP templates. Keep the notification encryption key stable and private. For the existing Gmail setup, credentials were verified by SMTP authentication and configured in Vercel production. Application receipts, approval attachments and OTPs were delivered to a local SMTP sink; SMTP approval attachments no longer depend on a Resend key. External inbox delivery remains a separate check. No actual credentials are checked into the repository.

During care, the assigned nanny submits their completion report, then selects **Send completion code to family**. Report edits invalidate previous codes. The client receives the code at the booking email (or their canonical Auth email for an owned booking), and shares it only after that nanny's agreed work is complete. The nanny enters it in their placement. Codes are bound to the booking, assignment and booking revision; expiry, rescheduling/reassignment, use and failed-attempt limits prevent reuse. Each requested nanny must be confirmed before the booking closes. Dates and an admin status change can no longer complete a placement without these confirmations. Historical completed bookings stay unchanged. Ordinary notifications still use the scheduled durable queue; OTP delivery is immediate. SMTP reuses a stable Message-ID, but cannot promise provider-level deduplication after an ambiguous connection failure; operators must check delivery before manually retrying queued mail.

References: [Supabase custom email token generation](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), [Nodemailer Gmail app passwords](https://nodemailer.com/guides/using-gmail), [SMTP verification](https://nodemailer.com/smtp).
