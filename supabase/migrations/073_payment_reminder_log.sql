-- A record of each payment reminder an instructor sends to a pupil who owes money (by push, or by email when
-- the pupil has no app). The backend reads it to allow one reminder per pupil every few days, and to tell the
-- instructor when they last sent one. Backend only: row level security is on and there are no policies.
create table if not exists public.payment_reminder_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  sent_by_instructor_id uuid references public.instructors(id) on delete set null,
  amount_gbp numeric(10,2) not null,
  channel text not null check (channel in ('push', 'email')),
  created_at timestamptz not null default now()
);
create index if not exists idx_payment_reminder_log_student on public.payment_reminder_log(student_id, created_at desc);
alter table public.payment_reminder_log enable row level security;
