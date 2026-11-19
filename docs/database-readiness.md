# Database readiness — 18 November 2026

The user chose the existing VacayNanny Supabase project (`eejvcawtqkpucqgsaqzp`) for the eventual rollout. No second hosted project was created. No live schema migration has been applied during this work.

## Verified

- OAuth access and read-only SQL queries against the correct project succeeded.
- All 211 existing public-table columns are present in the local baseline with matching types. The new schema adds 17 columns and removes none.
- Private application-data snapshots cover 18 public tables, with a verified SHA-256 checksum and file permissions `0600`. These exports exclude Auth users, Storage file bytes and platform settings and are not transactionally consistent managed backups. Schema metadata and existing function definitions are also saved under ignored `artifacts/database-review/`.
- A real local Supabase stack runs PostgreSQL 17, Auth, PostgREST and private Storage on a Docker network bound to loopback.
- 35 unit/database tests, 7 browser tests and 7 integration tests passed. Integration covers real Auth triggers, denied client role escalation, private document access, agreement review before publication, payment acceptance/amount/duplicate-settlement guards, form permissions and real application contact/waitlist/guest-booking routes.
- The local security advisor reports no warnings/errors; its remaining two informational findings are intentional server-only tables with RLS and no client policies (`payment_attempts` and `rate_limits`).
- Production dependency audit: no known vulnerabilities reported. Lint, TypeScript and the production build passed.

## Release sequence

1. Apply `supabase/payments_and_agreements.sql` to prepare payment/guest/agreement structures and privileged functions. Existing records and requests from the old deployed API retain their prior payment arrangement.
2. Apply `supabase/security_hardening.sql`. It pins the timestamp trigger's search path, removes public execution of internal trigger functions and closes client insert paths that bypass the application's validation and rate limits. Existing policy helpers remain available because public catalogue policies rely on them.
3. Complete Paystack business onboarding and provider tests. Review the drafted nanny agreement, complete the actual legal and insurance details and configure the approved PDF. Proposed commercial allocations are not yet an adopted billing implementation.
4. Release the refreshed application and `supabase/payment_cutover.sql` together. The refreshed API saves new bookings as `unpaid`; cutover also makes that the database default and installs the agreement publication trigger. Historical records are not treated as proof of provider payment.
5. Verify live schema, API permissions, legacy record preservation and security advisors after migration; then perform controlled checkout/email smoke checks with the intended merchant mode.

## Current external dependencies

Expanded OAuth authorization for database changes succeeded, and the local MCP configuration is now scoped to this project with the database/debugging feature groups. This running chat still exposes its earlier read-only tool catalogue; the migration tool must be loaded before applying remote DDL. Use the migration tool rather than sending DDL through the SQL query tool.

Paystack onboarding has not started, as confirmed by the user. No merchant payment or international-card acceptance has been tested. The agreement is a draft for business and Kenyan legal review, not an approved onboarding attachment. Leaked-password protection was reported disabled by the live advisor; review its availability/settings before release.

Relevant advisor references: [internal function permissions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [RLS without client policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
