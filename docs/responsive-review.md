# Responsive review — 19 November 2026

The local preview and review branch include a shared sign-in image panel and fixes for narrow-screen workspaces. Production has not been redeployed.

## Changes

- Sign-in, signup and password recovery share a coastal image on the left and a contained form on desktop. Smaller screens stack the image and form, with readable controls and enough room to scroll.
- Shared content boundaries keep the nanny portal, application review and informational pages aligned on wide screens.
- Application review and admin inbox cards wrap long email addresses and values. Flexible grid tracks no longer force these cards outside the viewport.
- The application tier comparison stacks in the narrower desktop form column so the Professional tier heading stays readable.
- On phones, the application progress control becomes a readable dropdown for returning to previous steps, while desktop keeps the full step navigation.
- Mobile navigation scrolls when the screen is short. Common action buttons have larger touch targets, and the booking dialog uses dynamic viewport height.
- Local review now includes synthetic family and nanny accounts, an application, an enquiry and a pending payment. No customer data or live writes are used.

## Verification

All **31 Playwright browser tests passed**. The suite checks descendants as well as document width, so hiding overflow on the body cannot conceal a broken card.

| Area | Coverage |
| --- | --- |
| Public pages | 17 routes at widths 320, 390, 768, 1024, 1440 and 2560 pixels |
| Operations | All 11 panels and a populated application review at the same six widths |
| Signed-in portals | Family bookings, payment controls, nanny profile/placements and safeguarding quiz at phone, tablet and desktop widths |
| Nanny application | All eight steps at 320, 768, 1024 and 1440 pixels; desktop independent scrolling and mobile normal scrolling |
| Authentication | Side-by-side desktop image/form, stacked touch layout, password visibility, and reachable submit button with a shorter viewport |
| Overlays | Booking, navigation and support at 844 × 390 landscape size; keyboard focus and Escape behavior |

ESLint, TypeScript and the production build passed. Browser checks use desktop Chrome and Chromium touch emulation. Physical iOS/Android devices and Safari/Firefox have not been tested in this pass.

## Local review

Run `npm run dev:review` and open `http://localhost:3101`. Use `local-review` with these fixture-only emails:

- `operator@example.test` — operations
- `family@example.test` — family bookings
- `nanny@example.test` — nanny portal

The review server binds to loopback and disables application writes, email and payment calls. These are sample accounts, not production credentials.
