create extension if not exists pgcrypto;

create or replace function public.set_contract_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.contract_brand_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_name text not null default '',
  logo_asset_path text,
  accent_color text not null default '#2448ff',
  secondary_color text not null default '#0f172a',
  font_key text not null default 'inter',
  header_variant text not null default 'split',
  footer_variant text not null default 'minimal',
  signature_layout text not null default 'signatory-right',
  theme_tokens jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.organization_legal_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  registered_name text not null default '',
  vat_number text not null default '',
  tax_code text not null default '',
  address_line1 text not null default '',
  city text not null default '',
  province text not null default '',
  postal_code text not null default '',
  country text not null default 'Italia',
  representative_name text not null default '',
  representative_role text not null default '',
  contact_email text not null default '',
  contact_phone text not null default '',
  privacy_controller_text text not null default '',
  forum_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.contract_templates (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'user' check (scope in ('user', 'platform')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  contract_type text not null default 'service_agreement',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  source_template_id uuid references public.contract_templates(id) on delete set null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'platform' and owner_user_id is null)
    or (scope = 'user' and owner_user_id is not null)
  )
);

create table if not exists public.contract_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.contract_templates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  questionnaire_schema jsonb not null default '{"steps":[]}'::jsonb,
  composition_schema jsonb not null default '{}'::jsonb,
  render_schema jsonb not null default '{}'::jsonb,
  default_values jsonb not null default '{}'::jsonb,
  locale text not null default 'it-IT',
  jurisdiction text not null default 'IT',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  unique (template_id, version_number)
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'contract_templates_current_version_id_fkey'
      and table_name = 'contract_templates'
  ) then
    alter table public.contract_templates
      add constraint contract_templates_current_version_id_fkey
      foreign key (current_version_id)
      references public.contract_template_versions(id)
      on delete set null;
  end if;
end
$$;

create table if not exists public.contract_clause_blocks (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'user' check (scope in ('user', 'platform')),
  owner_user_id uuid references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  contract_type text not null default 'service_agreement',
  locale text not null default 'it-IT',
  jurisdiction text not null default 'IT',
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'platform' and owner_user_id is null)
    or (scope = 'user' and owner_user_id is not null)
  )
);

create table if not exists public.contract_clause_block_versions (
  id uuid primary key default gen_random_uuid(),
  clause_block_id uuid not null references public.contract_clause_blocks(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  body_html text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  variable_slots jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users(id) on delete set null,
  unique (clause_block_id, version_number)
);

create table if not exists public.contract_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid references public.contract_templates(id) on delete set null,
  template_version_id uuid references public.contract_template_versions(id) on delete set null,
  source_contact_id uuid,
  title text not null default 'Nuova bozza contratto',
  answers jsonb not null default '{}'::jsonb,
  preview_cache jsonb not null default '{}'::jsonb,
  validation_state jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  last_autosave_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contract_instances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid references public.contract_drafts(id) on delete set null,
  template_id uuid references public.contract_templates(id) on delete set null,
  template_version_id uuid references public.contract_template_versions(id) on delete set null,
  template_name text not null default '',
  contract_type text not null default 'service_agreement',
  title text not null default '',
  selected_clause_version_ids jsonb not null default '[]'::jsonb,
  answers jsonb not null default '{}'::jsonb,
  computed_values jsonb not null default '{}'::jsonb,
  resolved_document jsonb not null default '{}'::jsonb,
  resolved_html text not null default '',
  brand_snapshot jsonb not null default '{}'::jsonb,
  legal_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'generated' check (status in ('generated', 'exported')),
  renderer_version text not null default '',
  generated_by_user_id uuid references auth.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.contract_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instance_id uuid not null references public.contract_instances(id) on delete cascade,
  export_type text not null check (export_type in ('html', 'pdf')),
  storage_bucket text not null,
  storage_path text not null,
  renderer_version text not null default '',
  checksum text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists contract_templates_user_slug_unique
  on public.contract_templates (owner_user_id, slug)
  where scope = 'user';

create unique index if not exists contract_templates_platform_slug_unique
  on public.contract_templates (slug)
  where scope = 'platform';

create unique index if not exists contract_clause_blocks_user_slug_unique
  on public.contract_clause_blocks (owner_user_id, slug)
  where scope = 'user';

create unique index if not exists contract_clause_blocks_platform_slug_unique
  on public.contract_clause_blocks (slug)
  where scope = 'platform';

create index if not exists contract_templates_owner_status_idx
  on public.contract_templates (owner_user_id, status, created_at desc);

create index if not exists contract_drafts_user_status_idx
  on public.contract_drafts (user_id, status, updated_at desc);

create index if not exists contract_instances_user_status_idx
  on public.contract_instances (user_id, status, created_at desc);

create index if not exists contract_template_versions_lookup_idx
  on public.contract_template_versions (template_id, published_at desc nulls last, created_at desc);

create index if not exists contract_exports_instance_idx
  on public.contract_exports (instance_id, created_at desc);

drop trigger if exists contract_brand_profiles_set_updated_at on public.contract_brand_profiles;
create trigger contract_brand_profiles_set_updated_at
before update on public.contract_brand_profiles
for each row execute function public.set_contract_updated_at();

drop trigger if exists organization_legal_profiles_set_updated_at on public.organization_legal_profiles;
create trigger organization_legal_profiles_set_updated_at
before update on public.organization_legal_profiles
for each row execute function public.set_contract_updated_at();

drop trigger if exists contract_templates_set_updated_at on public.contract_templates;
create trigger contract_templates_set_updated_at
before update on public.contract_templates
for each row execute function public.set_contract_updated_at();

drop trigger if exists contract_clause_blocks_set_updated_at on public.contract_clause_blocks;
create trigger contract_clause_blocks_set_updated_at
before update on public.contract_clause_blocks
for each row execute function public.set_contract_updated_at();

drop trigger if exists contract_drafts_set_updated_at on public.contract_drafts;
create trigger contract_drafts_set_updated_at
before update on public.contract_drafts
for each row execute function public.set_contract_updated_at();

alter table public.contract_brand_profiles enable row level security;
alter table public.organization_legal_profiles enable row level security;
alter table public.contract_templates enable row level security;
alter table public.contract_template_versions enable row level security;
alter table public.contract_clause_blocks enable row level security;
alter table public.contract_clause_block_versions enable row level security;
alter table public.contract_drafts enable row level security;
alter table public.contract_instances enable row level security;
alter table public.contract_exports enable row level security;

drop policy if exists "contract_brand_profiles_select" on public.contract_brand_profiles;
create policy "contract_brand_profiles_select" on public.contract_brand_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "contract_brand_profiles_insert" on public.contract_brand_profiles;
create policy "contract_brand_profiles_insert" on public.contract_brand_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "contract_brand_profiles_update" on public.contract_brand_profiles;
create policy "contract_brand_profiles_update" on public.contract_brand_profiles
  for update using (auth.uid() = user_id);
drop policy if exists "contract_brand_profiles_delete" on public.contract_brand_profiles;
create policy "contract_brand_profiles_delete" on public.contract_brand_profiles
  for delete using (auth.uid() = user_id);

drop policy if exists "organization_legal_profiles_select" on public.organization_legal_profiles;
create policy "organization_legal_profiles_select" on public.organization_legal_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "organization_legal_profiles_insert" on public.organization_legal_profiles;
create policy "organization_legal_profiles_insert" on public.organization_legal_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "organization_legal_profiles_update" on public.organization_legal_profiles;
create policy "organization_legal_profiles_update" on public.organization_legal_profiles
  for update using (auth.uid() = user_id);
drop policy if exists "organization_legal_profiles_delete" on public.organization_legal_profiles;
create policy "organization_legal_profiles_delete" on public.organization_legal_profiles
  for delete using (auth.uid() = user_id);

drop policy if exists "contract_templates_select" on public.contract_templates;
create policy "contract_templates_select" on public.contract_templates
  for select using (scope = 'platform' or owner_user_id = auth.uid());
drop policy if exists "contract_templates_insert" on public.contract_templates;
create policy "contract_templates_insert" on public.contract_templates
  for insert with check (scope = 'user' and owner_user_id = auth.uid());
drop policy if exists "contract_templates_update" on public.contract_templates;
create policy "contract_templates_update" on public.contract_templates
  for update using (scope = 'user' and owner_user_id = auth.uid())
  with check (scope = 'user' and owner_user_id = auth.uid());
drop policy if exists "contract_templates_delete" on public.contract_templates;
create policy "contract_templates_delete" on public.contract_templates
  for delete using (scope = 'user' and owner_user_id = auth.uid());

drop policy if exists "contract_template_versions_select" on public.contract_template_versions;
create policy "contract_template_versions_select" on public.contract_template_versions
  for select using (
    exists (
      select 1 from public.contract_templates t
      where t.id = contract_template_versions.template_id
        and (t.scope = 'platform' or t.owner_user_id = auth.uid())
    )
  );
drop policy if exists "contract_template_versions_insert" on public.contract_template_versions;
create policy "contract_template_versions_insert" on public.contract_template_versions
  for insert with check (
    exists (
      select 1 from public.contract_templates t
      where t.id = contract_template_versions.template_id
        and t.scope = 'user'
        and t.owner_user_id = auth.uid()
    )
  );
drop policy if exists "contract_template_versions_update" on public.contract_template_versions;
create policy "contract_template_versions_update" on public.contract_template_versions
  for update using (
    exists (
      select 1 from public.contract_templates t
      where t.id = contract_template_versions.template_id
        and t.scope = 'user'
        and t.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.contract_templates t
      where t.id = contract_template_versions.template_id
        and t.scope = 'user'
        and t.owner_user_id = auth.uid()
    )
  );
drop policy if exists "contract_template_versions_delete" on public.contract_template_versions;
create policy "contract_template_versions_delete" on public.contract_template_versions
  for delete using (
    exists (
      select 1 from public.contract_templates t
      where t.id = contract_template_versions.template_id
        and t.scope = 'user'
        and t.owner_user_id = auth.uid()
    )
  );

drop policy if exists "contract_clause_blocks_select" on public.contract_clause_blocks;
create policy "contract_clause_blocks_select" on public.contract_clause_blocks
  for select using (scope = 'platform' or owner_user_id = auth.uid());
drop policy if exists "contract_clause_blocks_insert" on public.contract_clause_blocks;
create policy "contract_clause_blocks_insert" on public.contract_clause_blocks
  for insert with check (scope = 'user' and owner_user_id = auth.uid());
drop policy if exists "contract_clause_blocks_update" on public.contract_clause_blocks;
create policy "contract_clause_blocks_update" on public.contract_clause_blocks
  for update using (scope = 'user' and owner_user_id = auth.uid())
  with check (scope = 'user' and owner_user_id = auth.uid());
drop policy if exists "contract_clause_blocks_delete" on public.contract_clause_blocks;
create policy "contract_clause_blocks_delete" on public.contract_clause_blocks
  for delete using (scope = 'user' and owner_user_id = auth.uid());

drop policy if exists "contract_clause_block_versions_select" on public.contract_clause_block_versions;
create policy "contract_clause_block_versions_select" on public.contract_clause_block_versions
  for select using (
    exists (
      select 1 from public.contract_clause_blocks b
      where b.id = contract_clause_block_versions.clause_block_id
        and (b.scope = 'platform' or b.owner_user_id = auth.uid())
    )
  );
drop policy if exists "contract_clause_block_versions_insert" on public.contract_clause_block_versions;
create policy "contract_clause_block_versions_insert" on public.contract_clause_block_versions
  for insert with check (
    exists (
      select 1 from public.contract_clause_blocks b
      where b.id = contract_clause_block_versions.clause_block_id
        and b.scope = 'user'
        and b.owner_user_id = auth.uid()
    )
  );
drop policy if exists "contract_clause_block_versions_update" on public.contract_clause_block_versions;
create policy "contract_clause_block_versions_update" on public.contract_clause_block_versions
  for update using (
    exists (
      select 1 from public.contract_clause_blocks b
      where b.id = contract_clause_block_versions.clause_block_id
        and b.scope = 'user'
        and b.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.contract_clause_blocks b
      where b.id = contract_clause_block_versions.clause_block_id
        and b.scope = 'user'
        and b.owner_user_id = auth.uid()
    )
  );
drop policy if exists "contract_clause_block_versions_delete" on public.contract_clause_block_versions;
create policy "contract_clause_block_versions_delete" on public.contract_clause_block_versions
  for delete using (
    exists (
      select 1 from public.contract_clause_blocks b
      where b.id = contract_clause_block_versions.clause_block_id
        and b.scope = 'user'
        and b.owner_user_id = auth.uid()
    )
  );

drop policy if exists "contract_drafts_select" on public.contract_drafts;
create policy "contract_drafts_select" on public.contract_drafts
  for select using (auth.uid() = user_id);
drop policy if exists "contract_drafts_insert" on public.contract_drafts;
create policy "contract_drafts_insert" on public.contract_drafts
  for insert with check (auth.uid() = user_id);
drop policy if exists "contract_drafts_update" on public.contract_drafts;
create policy "contract_drafts_update" on public.contract_drafts
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "contract_drafts_delete" on public.contract_drafts;
create policy "contract_drafts_delete" on public.contract_drafts
  for delete using (auth.uid() = user_id);

drop policy if exists "contract_instances_select" on public.contract_instances;
create policy "contract_instances_select" on public.contract_instances
  for select using (auth.uid() = user_id);
drop policy if exists "contract_instances_insert" on public.contract_instances;
create policy "contract_instances_insert" on public.contract_instances
  for insert with check (auth.uid() = user_id);
drop policy if exists "contract_instances_update" on public.contract_instances;
create policy "contract_instances_update" on public.contract_instances
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "contract_instances_delete" on public.contract_instances;
create policy "contract_instances_delete" on public.contract_instances
  for delete using (auth.uid() = user_id);

drop policy if exists "contract_exports_select" on public.contract_exports;
create policy "contract_exports_select" on public.contract_exports
  for select using (auth.uid() = user_id);
drop policy if exists "contract_exports_insert" on public.contract_exports;
create policy "contract_exports_insert" on public.contract_exports
  for insert with check (auth.uid() = user_id);
drop policy if exists "contract_exports_update" on public.contract_exports;
create policy "contract_exports_update" on public.contract_exports
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
drop policy if exists "contract_exports_delete" on public.contract_exports;
create policy "contract_exports_delete" on public.contract_exports
  for delete using (auth.uid() = user_id);
