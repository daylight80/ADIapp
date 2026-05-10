# DriveHub UK – Driving Instructor & Student Portal (Expo)

## Overview
A comprehensive React Native (Expo SDK 54) mobile app for UK driving instructors and their students.
Mobile-first with tablet adaptation. Strict British English throughout. Orange + Blue branding.

## Tech Stack
- Frontend: Expo SDK 54, expo-router, React Native, lucide-react-native, expo-secure-store
- Backend: FastAPI + MongoDB (Motor) + JWT auth (HS256, passlib/bcrypt)
- Charts: Custom View-based bar chart (web preview compatible)
- State: AuthContext (real backend) + in-memory mock store (`src/mockDb.ts`) ready to swap for Supabase

## Roles
- **Instructor**: Manage students, lessons, view KPIs and earnings.
- **Student**: View readiness, DVSA competencies, take DL25 mock test.

## Demo Credentials (auto-seeded on backend startup)
- Instructor: `instructor@demo.uk` / `password123`
- Student: `student@demo.uk` / `password123`

## Screens
1. `/sign-up-login-screen` – Tabs Sign In / Create Account + demo panel + ToS/Privacy links
2. `/home-screen` (instructor) – KPI grid, prominent orange Students button, MTD, Earnings bar chart, Today's lessons
3. `/lesson-diary-screen` – Weekly time grid (Mon-Sun, 08:00-19:00), week arrows, Add/Detail bottom sheets
4. `/student-crm-screen` – Searchable list, filter chips (All/Active/Test Ready/New with counts), Add Student FAB → bottom sheet → snackbar
5. `/student-lifecycle-screen?id=` – 4 tabs: Overview, Lessons, Competency, Earnings
6. `/student-home-screen` (student) – Driving Readiness, 12 DVSA competency tracker, Mock test widget, Lesson feedback
7. `/competency-detail-screen?id=&key=` – 3 tabs: Overview (milestones), Lessons (expandable), Skills (per-skill)
8. `/dl25-mock-test-screen` – 12 DVSA categories x driving/serious/dangerous fault counters
9. `/dl25-report-screen` – Pass/Fail card, fault summary, breakdown by category
10. `/profile-screen` – Account info, sign out

## Backend Endpoints (all prefixed `/api`)
- `POST /api/auth/register` – { email, password, name, role }
- `POST /api/auth/login` – { email, password }
- `GET  /api/auth/me` – requires `Authorization: Bearer <token>`
- `GET  /api/health`

## Mocked / Swap-ready
Domain data (students, lessons, competencies, earnings) lives in `/app/frontend/src/mockDb.ts`.
The API surface (`listStudents`, `addStudent`, `listLessonsForWeek`, `getCompetencies`, etc.) is
designed to be replaced 1:1 with Supabase calls when desired.

## Smart Business Enhancement
The DL25 mock test result + DVSA competency tracker doubles as a **lead-conversion engine**:
showing students a clear "Driving readiness %" and gamified milestones drives more lesson
bookings before tests, increasing instructor revenue per student.
