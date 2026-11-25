# Nanny photos and work categories — 25 November 2026

Nannies can open **Nanny portal → Update my profile photo** or **Profile & availability**. **Choose photo** selects a JPEG/PNG/WebP file; **Take photo** requests the front-facing camera on supported phones. Other devices may display their file picker. The editor previews the selection and uses a separate **Save photo** action. It decodes images before upload and resizes large phone photos to at most 1600 pixels on the longest edge and under the 4 MB request limit. Files over 25 MB or unsupported/invalid images produce an inline error. A failed save retains the selection for retry.

Administrators can open **Admin → Nannies → Update profile photo** to upload, take or remove a photo for a nanny. Public nanny photos are distinct from private-account avatars; the account form links to the public editor. Photo updates do not change vetting, tier, pricing, ownership or publication status.

The server checks authenticated ownership or administrator access. The Storage upload uses a new unique URL, verifies MIME/signature and is staged for delayed cleanup. A server-only transaction commits the profile photo, retired-photo cleanup job and audit together. Cleanup retains any photo still referenced by another profile or site record.

| Nanny's effective qualification | Eligible work categories |
| --- | --- |
| Bronze | Bronze |
| Silver | Bronze, Silver |
| Gold, safeguarding complete | Bronze, Silver, Gold |

An approved Gold nanny without completed safeguarding keeps the existing Silver effective qualification until the module is completed. Other requirements—availability, suspension, destination coverage, infant/overnight skills, child capacity and booking conflicts—still apply independently.

Search and matching use this hierarchy. The public badge continues to describe the nanny's qualification; a selected work category is shown with its care rate and is preserved when opening a profile or booking form. A higher-qualified nanny can fulfil a lower-category request without an automatic upgrade or price increase. New lower-category bookings use that category's published rate. An existing booking retains its category and agreed total when staffing changes. A changed category requires a new booking request.

Database triggers also enforce qualification for primary and additional assignments, direct mutation RPC calls, rescheduling and care start. The migration does not reclassify nanny profiles or rewrite historical bookings. Its new functions are server-only and use fixed search paths. Apply `supabase/migrations/20261125151144_tier_eligibility_and_nanny_photos.sql` after the earlier portal and queue release; do not replay previous migrations.

Validation covers all nine qualification/category combinations, the safeguarding prerequisite, category/price preservation and direct underqualified-assignment rejection. Real local Storage tests cover JPEG/PNG uploads, owner/admin permissions, public download, replacement/removal audit and delayed cleanup. Browser tests exercise upload, camera capture selection with a JPEG fixture, large-image resizing, retry after network failure, admin editing and public search/booking category continuity. The automated camera check verifies the capture request and file flow; it does not operate a physical phone camera.
