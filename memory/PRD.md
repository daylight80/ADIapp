# DriveHub UK – Driving Instructor & Student Portal (Expo)

## Overview
A comprehensive React Native (Expo SDK 54) mobile app for UK driving instructors and their students.
Mobile-first with tablet adaptation. Strict British English throughout. Orange + Blue branding.

## Tech Stack
- Frontend: Expo SDK 54, expo-router, expo-print, expo-sharing, expo-notifications, expo-web-browser, expo-secure-store, lucide-react-native
- Backend: FastAPI + MongoDB (Motor) + JWT auth + Stripe subscriptions
- Charts: Custom View-based bar chart (web preview compatible)
- State: AuthContext (real backend) + in-memory mock store (`src/mockDb.ts`) ready to swap for Supabase

## Roles
- **Instructor**: Manage students, lessons, view KPIs and earnings, subscribe to Pro
- **Student**: View readiness, DVSA competencies, take DL25 mock test

## Demo Credentials (auto-seeded on backend startup)
- Instructor: `instructor@demo.uk` / `password123`
- Student: `student@demo.uk` / `password123`

## Screens
1. `/sign-up-login-screen` – Tabs Sign In / Create Account + demo panel + ToS/Privacy links
2. `/home-screen` (instructor) – KPI grid, prominent orange Students button, MTD, Earnings bar chart, Today's lessons, **Upgrade to Pro banner / Pro active strip**
3. `/lesson-diary-screen` – Weekly grid, Add Lesson bottom sheet (Pro: schedules 24h/1h reminders)
4. `/student-crm-screen` – Searchable list, filter chips, **tier usage banner**, **FAB locks at 5 with PaywallModal**, Add Student
5. `/student-lifecycle-screen?id=` – 4 tabs: Overview, Lessons, Competency, **Earnings (with Invoice PDF button — Pro only)**
6. `/student-home-screen` (student) – Driving Readiness, 12 DVSA competencies, Mock test widget
7. `/competency-detail-screen?id=&key=` – 3 tabs: Overview, Lessons, Skills
8. `/dl25-mock-test-screen` – 12 DVSA categories × driving/serious/dangerous counters
9. `/dl25-report-screen` – Pass/Fail card, fault summary, breakdown by category
10. `/profile-screen` – Account info, **Upgrade to Pro button**, sign out
11. `/pricing-screen` – Free vs Pro plan cards, £9.99/mo, Stripe Checkout, Customer Portal, dev cancel

## Freemium Tier (Pro – £9.99/month GBP)
| Feature                     | Free          | Pro |
|-----------------------------|---------------|-----|
| Students                    | Up to 5       | Unlimited |
| KPIs, diary, CRM, lifecycle | ✓             | ✓ |
| DL25 mock test + report     | ✓             | ✓ |
| **PDF invoice download**    | ✗             | ✓ (in-app PDF with VAT) |
| **Lesson reminders (24h/1h)** | ✗           | ✓ (local + push) |
| **New student / payment notifications** | ✗ | ✓ |

Enforcement: hard block at 6th student → PaywallModal opens. FAB shows Crown icon when locked.

## Backend Endpoints (all prefixed `/api`)
- `POST /api/auth/register` { email, password, name, role }
- `POST /api/auth/login` { email, password } → returns user with subscription_status
- `GET  /api/auth/me`
- `GET  /api/health`
- `POST /api/billing/create-checkout-session` → returns Stripe checkout URL (instructor only)
- `GET  /api/billing/subscription-status`
- `POST /api/billing/verify-session` { session_id } → verifies and updates after return
- `POST /api/billing/create-portal-session` → Stripe customer portal
- `POST /api/billing/cancel-mock` → dev helper, revert to Free
- `POST /api/billing/webhook` → handles checkout.session.completed, customer.subscription.deleted, invoice.payment_failed

## ⚠️ Required Setup for Live Stripe Flow
`STRIPE_API_KEY` in `/app/backend/.env` is currently a placeholder (`sk_test_emergent`). To make Subscribe button work end-to-end:
1. Get a real Stripe test secret key from https://dashboard.stripe.com/test/apikeys (starts with `sk_test_`)
2. Replace `STRIPE_API_KEY=sk_test_emergent` in `/app/backend/.env`
3. `sudo supervisorctl restart backend`
4. (Optional, for webhooks in production) Set `STRIPE_WEBHOOK_SECRET=whsec_…` from the webhook endpoint in Stripe dashboard

All code is in place — only the key needs to be set.

## Mocked / Swap-ready
- Domain data (students, lessons, competencies, earnings) in `src/mockDb.ts` — designed for Supabase swap
- Stripe webhook signature verification is bypassed when `STRIPE_WEBHOOK_SECRET` is empty (preview env only)

## Smart Business Enhancements
- **Driving Readiness %** + gamified DVSA milestones drive lesson bookings before tests
- **Freemium model**: students 1–5 are free for instructors, conversion gate at 6 with clear value prop (invoicing + reminders) priced low enough (£9.99) to convert easily
- **VAT-compliant PDF invoice** saves UK instructors ~1 hour/week of admin
