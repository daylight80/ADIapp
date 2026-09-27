# ADI Pro

A management platform for UK driving instructors and driving schools — lesson diary,
student CRM, DVSA progress tracking, mock tests, invoicing/wallet, and referrals — built
as a single Expo codebase that ships to iOS, Android and the web.

- **Web app**: [webapp.drivingschoolsolutions.co.uk](https://webapp.drivingschoolsolutions.co.uk) (also reachable at `adiapp.netlify.app`)
- **Backend API**: FastAPI, hosted on Render
- **Database/Auth/Storage**: Supabase (Postgres + Row Level Security)

## Tiers

| Tier | Price | Instructors | Students | Notes |
|---|---|---|---|---|
| Starter | Free | 1 | up to 5 | No invoicing |
| ADI Pro | £11.99/mo | 1 | unlimited | Invoicing, business branding |
| Franchise | £13.99/mo + £9.99/seat | unlimited | unlimited | Multi-instructor schools |

(Internally the ADI Pro tier's id is still `pro` in the database — only the display name
changed.)

## Repo layout

```
frontend/               Expo app (React Native + web export), expo-router
  app/                   Screens/routes
  src/                   Shared logic, hooks, helpers
backend/                 FastAPI backend
  tests/                 Backend test suite (pytest)
supabase/
  migrations/            Numbered SQL migrations (applied in order via Supabase MCP/CLI)
  email-templates/       HTML templates mirrored into the Supabase Auth email settings
design_guidelines.json   Design tokens (colors, etc.) used throughout the app
```

## Key features

- Lesson diary and scheduling, with availability/unavailability blocks
- Student CRM with lifecycle status (lead → active → passed/cancelled, with undo)
- DVSA progress tracker and DL25 mock tests — runnable by the student or started by the
  instructor from the student's profile
- Wallet and Stripe-powered invoicing (ADI Pro and Franchise tiers)
- Referral and transactional email via Resend (referral invites, signup confirmation,
  password reset)
- Owner/franchise dashboards for schools with multiple instructors

## Development

```bash
cd frontend
npm install
npm run web       # or: npm run ios / npm run android
```

Backend:

```bash
cd backend
pip install -r requirements.txt
pytest tests/
```

Environment variables (Supabase URL/keys, API base URL, Stripe/Resend keys) are read from
`.env` files that are not committed — ask the project owner for values, or see
`frontend/.env.example` / `backend/.env.example` if present.

## Database changes

Schema changes live as numbered files in `supabase/migrations/`. Apply new migrations via
the Supabase MCP tools or the Supabase CLI, in order, against the project's Postgres
instance — never edit an already-applied migration file in place.

## Deploys

- **Web**: pushes to `main` that touch `frontend/` trigger a Netlify build automatically.
- **Backend**: pushes to `main` that touch `backend/` trigger a Render deploy automatically.
- **Mobile**: built via EAS (`eas build`); see Expo's dashboard for build status and limits.
