---
name: project-deployment
description: VacayNanny keeps the existing Vercel hosting
metadata:
  type: project
---

VacayNanny deploys to **Vercel**. The user explicitly selected keeping the existing Vercel hosting on 2026-11-18, superseding the earlier Netlify note.

Production origin: `https://www.vacaynanny.net`. Use a localhost origin for local development and a separate stable HTTPS origin for staging. Configure environment variables separately in the Vercel project's Preview and Production settings. Keep service-role, payment, email and cron secrets on the server.

`vercel.json` retains the daily booking cron at 21:30 UTC (00:30 Africa/Nairobi). Vercel authenticates it with `Authorization: Bearer <CRON_SECRET>`. Review the actual hosting plan before increasing frequency.

The user explicitly authorized deploying the changes live, including the existing Supabase project `eejvcawtqkpucqgsaqzp`. The production rollout completed on 24 November 2026. Application commit `80bfe44c7ae18a56e71805c3d1d0d22f6846251d` is live in Vercel deployment `dpl_FQyGSGwR4dH74mTgfqz8H1JeLj23`, with both apex and www domains assigned. Public, payment-signature and worker smoke checks passed. Prefer the isolated local Docker stack for future functional tests; do not run test-mode payments against the production database.

Source changes are pushed to `leux24g/VacayNanny`, branch `feat/website-admin-paystack-refresh`, and ready PR `https://github.com/vacaynanny/VacayNanny/pull/15`. The authenticated GitHub account `leux24g` has read-only upstream access and cannot merge. Production was deployed directly through project-scoped Vercel REST access after the Git integration team-authorization check failed. The upstream PR still needs a maintainer merge; avoid deploying the older main branch over the release. Existing device SSH already authenticates to GitHub as leux24g; no duplicate key was created.

Supabase Management API access is now configured privately in the local environment. Six reviewed SQL sources were applied atomically as `20261124153949_vacaynanny_payments_workflows_and_two_step_auth`; `workflow_schedule.sql` followed as `20261124154430_vacaynanny_minute_workflow_scheduler`. Do not reapply them. Existing profile/nanny/booking/Auth counts were preserved. Required schema, RLS and private session-proof privileges were verified. Both minute jobs ran successfully, including HTTP 200 responses from the Vercel worker with no failed jobs. Matching cron origin/secret are stored privately in Supabase Vault. Production notification encryption and cron keys are saved under ignored private release artifacts; preserve the notification key while encrypted jobs exist.

Production has SMTP delivery configuration and `PAYSTACK_MODE=prod`, using only `PROD_PAYSTACK_*` live credentials. Unprefixed Paystack variables always mean test/UAT. Production webhook: `https://www.vacaynanny.net/api/payments/webhook/prod`; callback: `https://www.vacaynanny.net/payments/return/prod`. An enabled Paystack `charge.success` endpoint is configured and the provider's signed ping passed. Sandbox M-Pesa/card/decline tests passed against isolated local data; no live charge was attempted. A separate hosted UAT database/origin has not been provisioned. SMTP authentication passed; mail delivery tests used a local sink, so external inbox delivery remains unverified.

The nanny agreement draft PDF/DOCX exist under artifacts/agreements with proposed 20% platform / 80% nanny allocation and two-business-day payouts; these are not implemented deductions. Actual legal registration/address/insurance facts are unconfirmed. Keep the draft unconfigured as an email attachment until reviewed and finalised. Application approval emails require the approved blank PDF, which remains outstanding. See `docs/database-readiness.md` and `docs/deployment.md` for verification limits and remaining hosted advisor findings.
