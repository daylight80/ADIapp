# DriveHub UK – Driving Instructor & Student Portal

## Roles & Onboarding
- **Instructor self-registration** on `/sign-up-login-screen` → requires **DVSA ADI number** (unique). ADI is the primary business key for the instructor's data.
- **Students cannot self-register**. The instructor invites them via `/student-crm-screen` → "Generate invite link" → Copy or send by SMS. Link is `/sign-up-login-screen?invite=<JWT>`, valid 7 days.

## Demo Credentials (auto-seeded)
- Instructor: `instructor@demo.uk` / `password123` (ADI **123456**)
- Student: `student@demo.uk` / `password123` (linked via `invited_by_adi='123456'`)

## Screens (16)
1. `/sign-up-login-screen` – Sign In + Create Instructor Account tabs; **handles `?invite=TOKEN`** for student onboarding
2. `/home-screen` (instructor)
3. `/lesson-diary-screen` – Weekly grid + LessonToolsSheet (Navigate/I'm Here/Pre-check/Cancel & broadcast)
4. `/student-crm-screen` – Searchable list + Invite Student flow with link reveal sheet
5. `/student-lifecycle-screen`
6. `/student-home-screen` – Readiness, DVSA tracker, Badges, Theory + Wallet shortcuts, Reflective log
7. `/competency-detail-screen`
8. `/dl25-mock-test-screen`
9. `/dl25-report-screen`
10. `/profile-screen` – ADI editor (instructor) / Copy ADI (student), Pupil Agreement, Wallet, Pricing
11. `/pricing-screen` – Stripe £9.99/mo subscription
12. `/theory-test-screen` – 10-question UK Highway Code mock
13. `/wallet-screen` – Block bookings + VAT receipts
14. `/onboarding-tc-screen` – Pupil Agreement with typed signature + timestamp

## Backend API (FastAPI + MongoDB, `/api` prefix)
- **Auth**: register (instructor + ADI), login, me
- **Invites**: `POST /instructor/invite-student`, `GET /auth/invite/{token}`, `POST /auth/accept-invite`
- **Billing**: create-checkout-session, verify-session, subscription-status, create-portal-session, webhook, cancel-mock
- **Health**: `/api/health`

## Database (MongoDB)
- Users collection: `id`, `email` (unique), `name`, `role`, `adi_number` (unique **partial index** for non-null strings), `invited_by_adi`, `password`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`, `created_at`
- The ADI partial unique index correctly excludes student records (null ADI) so multiple students can coexist while still enforcing instructor uniqueness.

## Pro Tier (£9.99/mo)
- Hard 5-student gate → Paywall modal
- PDF invoicing (VAT-compliant)
- Lesson reminder + new student notifications
- Stripe Customer Portal for billing management
- **Set up**: replace `STRIPE_API_KEY=sk_test_emergent` placeholder in `/app/backend/.env` with a real test key from https://dashboard.stripe.com/test/apikeys

## Mocked / Swap-ready
- Domain data (students, lessons, competencies, badges, reflections, block bookings, theory bank) in `src/mockDb.ts` — designed for Supabase swap.
- Stripe webhook signature verification bypassed when `STRIPE_WEBHOOK_SECRET` empty (preview env only).
- SMS composer copies to clipboard on web; native opens the device SMS app.

## Deferred (need keys or deep work)
- Google Maps traffic-aware travel time (needs your Google Maps API key)
- Real Twilio SMS (needs Twilio creds)
- HMRC MTD API, drag-and-drop calendar, dashcam clip-and-share, satellite-overlay whiteboard

## Tested
- 11/11 backend pytest cases pass (auth + invite + edge cases including replay attacks, garbage tokens, duplicate ADI)
- All targeted frontend flows pass (signup, invite-from-CRM, accept-invite via link, demo logins, regression on existing screens)
- Bug fixed during testing: ADI unique index changed from `sparse` to `partialFilterExpression` to allow multiple students with null ADI
