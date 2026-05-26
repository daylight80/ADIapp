# Supabase — ADI Pro database

This folder holds the canonical Postgres schema for the **ADI Pro** UK driving-school CRM. All SQL is hand-written so it can be applied through either the Supabase **SQL editor**, the **Supabase CLI** (`supabase db push`), or any standard `psql` connection.

## Apply the schema

Apply in order. All files are idempotent — re-running them is safe.

```
supabase/migrations/001_initial_schema.sql      # the 6 spec'd tables + RLS
supabase/migrations/002_extended_columns.sql    # CRM columns + auxiliary tables
supabase/migrations/003_subscription_tiers.sql  # Stripe 4-tier subscriptions
supabase/migrations/004_student_auth_link.sql   # link students to Supabase Auth
supabase/migrations/005_vehicles_default.sql    # vehicles is_default + RPC
```

### Option A — Supabase Dashboard (fastest)
1. Open your project → **SQL editor → New query**.
2. Paste **001_initial_schema.sql**, press **Run**.
3. Open a new query, paste **002_extended_columns.sql**, press **Run**.

### Option B — Supabase CLI
```bash
supabase link --project-ref <your-ref>
supabase db push
```

### Option C — Direct psql
```bash
psql "$DATABASE_URL" -f supabase/migrations/001_initial_schema.sql
```

## Schema overview

| Table | Purpose | Owner of write access |
|-------|---------|-----------------------|
| `driving_schools` | One row per franchise (or solo ADI) | `owner_auth_id` |
| `instructors` | Staff teaching at a school | School owner |
| `vehicles` | UK right-hand-drive fleet | School owner |
| `students` | Learners with a provisional licence | School owner; instructor for their own assignees |
| `lessons` | Scheduled / completed lessons | School owner; instructor for own lessons |
| `dvsa_syllabus_tracking` | Per-manoeuvre competency score (1–5) | School owner; instructor for own students |

All tables use `uuid` primary keys (`gen_random_uuid()`), include `created_at`/`updated_at` and trigger-driven `updated_at` maintenance.

### Foreign-key relationships
```
auth.users ─── owner ───→ driving_schools
auth.users ─── auth ────→ instructors  ─── school_id ─→ driving_schools
                                  │
                                  └─ id ───┐
driving_schools ─ school_id ─→ vehicles    │
driving_schools ─ school_id ─→ students ──── instructor_id
                                  │
                                  └─ id ───┐
students    ─── student_id ──→ lessons ──── instructor_id, vehicle_id
students    ─── student_id ──→ dvsa_syllabus_tracking
```

### UK-only constraint
`vehicles.is_right_hand_drive` is `boolean default true` plus a `CHECK (is_right_hand_drive = true)` constraint — so the database itself refuses to record a left-hand-drive car. `transmission` is constrained to `Manual | Automatic | Electric`.

## Row Level Security

RLS is enabled on every table. Two effective roles are derived from JWT claims:

| Role | How it's identified | Effective access |
|------|---------------------|-------------------|
| **School owner** | `driving_schools.owner_auth_id = auth.uid()` | Full CRUD on every row in their school |
| **Instructor** | `instructors.auth_user_id = auth.uid()` | • Read their school, colleagues, vehicles<br>• Full CRUD on their own students, lessons & DVSA rows<br>• Cannot reassign students to another instructor |

The `instructors.auth_user_id` column (added on top of the original spec) is what links a Supabase auth user to their instructor row — without it RLS cannot scope queries. Solo ADIs typically have the **same** `auth.users.id` as both `driving_schools.owner_auth_id` *and* an `instructors.auth_user_id` row, giving them both roles simultaneously.

### Helper SQL functions (security-definer)
| Function | Returns |
|----------|---------|
| `current_user_school_ids()` | Schools owned by the JWT user |
| `current_user_instructor_id()` | The instructor row id linked to the JWT user |
| `current_user_instructor_school_id()` | The school the JWT user teaches at |
| `is_school_owner(uuid)` | `boolean` — does the JWT user own this school |

These are `SECURITY DEFINER` so they can read the auth-controlled tables without recursive RLS conflicts.

## Smoke test (after applying)
```sql
-- 1. Owner sign-up flow ----------------------------------------------------
insert into public.driving_schools (business_name, owner_auth_id)
values ('SafeStart Driving School', auth.uid()) returning id;

-- 2. Add an instructor (you can promote yourself by setting auth_user_id) --
insert into public.instructors (school_id, auth_user_id, full_name, adi_number)
values ('<school-id>', auth.uid(), 'Alex Thompson', '123456');

-- 3. Verify RLS by switching JWT — owner can see all, instructor sees own --
select * from public.students;
```

## What's next
- **002_seed_demo.sql** — optional script to seed demo data mirroring the in-app `mockDb` (Sophie Carter, Oliver Bennett, etc.) for local development.
- **003_audit_logs.sql** — future change-history table once we wire instructor activity logging.
