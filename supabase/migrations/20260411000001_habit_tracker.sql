-- Habit Tracker monthly snapshots

create or replace function set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.habit_month_entries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  habit_uid        uuid not null,
  month_start      date not null,
  mode             text not null check (mode in ('daily', 'weekly')),
  name             text not null,
  goal             integer not null check (goal > 0),
  sort_order       integer not null default 0 check (sort_order >= 0),
  archived         boolean not null default false,
  completion_slots jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint habit_month_entries_user_habit_month_key unique (user_id, habit_uid, month_start),
  constraint habit_month_entries_completion_slots_is_array check (jsonb_typeof(completion_slots) = 'array')
);

alter table public.habit_month_entries enable row level security;

drop policy if exists "habit_month_entries_select" on public.habit_month_entries;
create policy "habit_month_entries_select"
  on public.habit_month_entries
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "habit_month_entries_insert" on public.habit_month_entries;
create policy "habit_month_entries_insert"
  on public.habit_month_entries
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "habit_month_entries_update" on public.habit_month_entries;
create policy "habit_month_entries_update"
  on public.habit_month_entries
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "habit_month_entries_delete" on public.habit_month_entries;
create policy "habit_month_entries_delete"
  on public.habit_month_entries
  for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists habit_month_entries_user_month_mode_sort
  on public.habit_month_entries (user_id, month_start, mode, sort_order);

create index if not exists habit_month_entries_user_habit_month
  on public.habit_month_entries (user_id, habit_uid, month_start);

drop trigger if exists trg_habit_month_entries_updated_at on public.habit_month_entries;
create trigger trg_habit_month_entries_updated_at
  before update on public.habit_month_entries
  for each row execute function set_updated_at();
