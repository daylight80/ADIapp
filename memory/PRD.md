# DriveHub UK – Driving Instructor & Student Portal (Expo)

## Overview
Production-grade React Native (Expo SDK 54) mobile app for UK driving instructors and their students. Mobile-first, tablet-aware. Strict British English. Orange + Blue brand. Freemium tier (£9.99/mo via Stripe).

## Roles & Demo Credentials
- Instructor: `instructor@demo.uk` / `password123`
- Student: `student@demo.uk` / `password123`

## Screens (16 total)
1. `/sign-up-login-screen` – Sign In / Create Account + demo panel
2. `/home-screen` (instructor) – KPI grid, orange Students CTA, MTD, Earnings chart, Today's lessons, Upgrade-to-Pro banner
3. `/lesson-diary-screen` – Weekly grid; tap lesson opens **LessonToolsSheet** (Navigate via Google/Waze/Apple, "I'm Here" SMS, Pre-lesson check, Cancel & broadcast)
4. `/student-crm-screen` – Searchable list, filter chips, 5-student gate with PaywallModal, tier-usage banner
5. `/student-lifecycle-screen` – 4 tabs: Overview, Lessons, Competency, Earnings (Pro: PDF invoice)
6. `/student-home-screen` (student) – Driving Readiness, DVSA Tracker, Mock test, Feedback, **Badges, Theory + Wallet shortcuts, Reflective log widget**
7. `/competency-detail-screen` – 3 tabs: Overview, Lessons, Skills
8. `/dl25-mock-test-screen` – 12 DVSA categories × fault counters
9. `/dl25-report-screen` – Pass/Fail card with breakdown
10. `/profile-screen` – Account, **ADI number (instructor) / Copy ADI (student), Pupil Agreement link, Wallet link**, Upgrade, sign out
11. `/pricing-screen` – Free vs Pro plan cards, Stripe Checkout, Customer Portal
12. `/theory-test-screen` – 10-question UK Highway Code mock with pass/fail and badge award
13. `/wallet-screen` – Hours remaining, buy block bookings (5/10/20h), VAT receipts
14. `/onboarding-tc-screen` – 5-section Pupil Agreement + typed signature + timestamp

## Wave 1 Features (latest iteration)
- **One-tap Navigation** from lesson tools → Google Maps / Waze / Apple Maps deep links
- **"I'm Here" SMS** composer with pre-filled message to the pupil
- **Pre-Lesson Indemnity Check** (Eyesight / Fitness / Licence) — required before lesson "starts", timestamped
- **Smart Gap Broadcast** — cancel a lesson → modal notifies N active students of the freed slot
- **Travel-time buffer** field on every lesson
- **Digital T&Cs** — 5-section Pupil Agreement with typed signature + timestamp + name preview
- **Gamification badges** — auto-awarded (First Gear, Mirror Master, Parallel Park Pro, Roundabout Ranger, Theory Champion, Mock Marvel)
- **Reflective Logs** — per-lesson journal in the student app (learner-centred teaching)
- **Test-Change Tracker** — enforces DVSA's Two-Change rule (max 2 reschedules)
- **ADI number** stored on instructor profile, copy-to-clipboard for students
- **Theory Test Suite** — 10 UK Highway Code Q&A (Signs/Speed/Safety/Manoeuvres/Junctions/Pedestrians/Eyesight/Roads/Alcohol), 80% pass mark
- **Payment Wallet** — block bookings (5/10/20 hours), hours-remaining tracker, VAT-receipt list

## Stripe Pro Tier
- £9.99/mo recurring, 5-student gate, PDF invoicing, push reminders, customer portal
- **Required setup** to test live checkout: replace `STRIPE_API_KEY=sk_test_emergent` placeholder in `/app/backend/.env` with a real key from https://dashboard.stripe.com/test/apikeys

## Backend (FastAPI + MongoDB)
- `/api/auth/*` (register, login, me)
- `/api/billing/*` (create-checkout-session, verify-session, subscription-status, create-portal-session, webhook, cancel-mock)

## Mocked / Swap-ready
- **MOCKED**: All domain data (students, lessons, badges, reflections, block bookings, wallet, theory bank, T&Cs, ADI) is in-memory in `src/mockDb.ts`. Designed for 1:1 Supabase swap.
- **MOCKED on web preview**: SMS composer copies to clipboard. Navigation opens new tab.
- **MOCKED**: Stripe webhook signature verification bypassed when `STRIPE_WEBHOOK_SECRET` is empty.

## Deferred (would need credentials / extra time)
- **Wave 2** (needs your keys): Real Twilio SMS, Google Maps traffic API, OCR receipt scanner, white-label branding
- **Wave 3** (needs deep work): HMRC MTD API, drag-and-drop calendar, dashcam clip-and-share, interactive whiteboard with satellite overlay

## Smart Business Enhancements (live)
1. Freemium gate at 5 students → £9.99/mo conversion lever
2. Gamification badges drive student engagement → retention
3. Reflective logs + ADI copy-paste differentiate from generic CRM tools
4. Block-booking wallet locks in revenue and discourages churn
5. Theory test mini-suite hooks students into the app between lessons
