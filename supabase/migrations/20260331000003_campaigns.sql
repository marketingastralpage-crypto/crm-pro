create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'running',
  draft jsonb not null default '{}',
  email_template text not null default '',
  email_subject text not null default '',
  target_contacts jsonb not null default '[]',
  sent int not null default 0,
  total int not null default 0,
  failed int not null default 0
);

alter table campaigns enable row level security;

create policy "campaigns_select" on campaigns
  for select using (auth.uid() = user_id);

create policy "campaigns_insert" on campaigns
  for insert with check (auth.uid() = user_id);

create policy "campaigns_update" on campaigns
  for update using (auth.uid() = user_id);

create policy "campaigns_delete" on campaigns
  for delete using (auth.uid() = user_id);
