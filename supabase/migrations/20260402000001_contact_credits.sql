-- Crediti utente per la generazione contatti e log dei job Apify

-- Funzione helper per aggiornare updated_at automaticamente
create or replace function set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------
-- user_credits: saldo crediti per utente (1 riga per user_id)
-- ----------------------------------------------------------------
create table if not exists user_credits (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  credits    integer     not null default 0 check (credits >= 0),
  updated_at timestamptz not null default now()
);

alter table user_credits enable row level security;

-- L'utente vede solo i propri crediti
create policy "user_credits_select" on user_credits
  for select using (auth.uid() = user_id);

-- UPDATE consentito via RLS; le edge functions agiscono con service role
-- e bypassano RLS, quindi questa policy non espone rischio di auto-ricarica
create policy "user_credits_update" on user_credits
  for update using (auth.uid() = user_id);

create trigger trg_user_credits_updated_at
  before update on user_credits
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------
-- contact_gen_jobs: log dei job di generazione contatti via Apify
-- ----------------------------------------------------------------
create table if not exists contact_gen_jobs (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references auth.users(id) on delete cascade,
  apify_run_id       text,
  location_en        text        not null,
  industry_en        text        not null,
  count_requested    integer     not null check (count_requested > 0),
  credits_used       integer     not null default 0,
  status             text        not null default 'pending'
                                 check (status in ('pending','running','succeeded','failed')),
  result_snapshot    jsonb,
  contacts_imported  integer     not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table contact_gen_jobs enable row level security;

create policy "contact_gen_jobs_select" on contact_gen_jobs
  for select using (auth.uid() = user_id);

create policy "contact_gen_jobs_insert" on contact_gen_jobs
  for insert with check (auth.uid() = user_id);

create policy "contact_gen_jobs_update" on contact_gen_jobs
  for update using (auth.uid() = user_id);

create trigger trg_contact_gen_jobs_updated_at
  before update on contact_gen_jobs
  for each row execute function set_updated_at();

-- Indice per listare i job dell'utente in ordine cronologico inverso
create index if not exists contact_gen_jobs_user_created
  on contact_gen_jobs (user_id, created_at desc);

-- ----------------------------------------------------------------
-- increment_credits: aggiornamento atomico dei crediti (usato da
-- apify-run-status per riaccredito in caso di run fallito)
-- ----------------------------------------------------------------
create or replace function increment_credits(p_user_id uuid, p_amount integer)
  returns void
  language sql
  security definer
as $$
  update user_credits
  set credits    = credits + p_amount,
      updated_at = now()
  where user_id = p_user_id;
$$;
