-- LeadFlow initial schema
-- Creates: profiles, icp_profiles, channels_cache, leads, delivery_log
-- Plus row-level security policies and updated_at triggers.

-- =============================================================================
-- Extensions
-- =============================================================================
create extension if not exists "pgcrypto";

-- =============================================================================
-- profiles
-- =============================================================================
create table public.profiles (
  id uuid references auth.users primary key,
  full_name text,
  email text not null,
  avatar_url text,
  subscription_tier text default 'free' check (subscription_tier in ('free', 'pro', 'agency')),
  onboarding_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =============================================================================
-- icp_profiles
-- =============================================================================
create table public.icp_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  niches text[] not null,
  keywords text[] not null,
  min_subscribers int default 1000,
  max_subscribers int default 500000,
  min_views_avg int default 1000,
  languages text[] default '{"en"}',
  must_have_link_in_bio boolean default true,
  must_have_email boolean default true,
  must_have_instagram boolean default false,
  excluded_channels text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- =============================================================================
-- channels_cache (shared pool, dedup by youtube_channel_id)
-- =============================================================================
create table public.channels_cache (
  id uuid primary key default gen_random_uuid(),
  youtube_channel_id text unique not null,
  channel_name text,
  subscriber_count int,
  avg_views int,
  description text,
  profile_image_url text,
  banner_url text,
  links_in_bio text[],
  has_website boolean default false,
  has_merch boolean default false,
  email_found text,
  instagram_handle text,
  instagram_url text,
  last_video_date timestamptz,
  niche_tags text[],
  fetched_at timestamptz default now(),
  enriched_at timestamptz
);

create index channels_cache_youtube_channel_id_idx
  on public.channels_cache (youtube_channel_id);
create index channels_cache_subscriber_count_idx
  on public.channels_cache (subscriber_count);
create index channels_cache_fetched_at_idx
  on public.channels_cache (fetched_at desc);

-- =============================================================================
-- leads (user <-> channel join with score/status)
-- =============================================================================
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  channel_id uuid references public.channels_cache(id) not null,
  score int default 0 check (score between 0 and 100),
  status text default 'new' check (status in ('new', 'viewed', 'saved', 'dismissed', 'contacted')),
  delivered_at timestamptz default now(),
  notes text,
  unique(user_id, channel_id)
);

create index leads_user_id_delivered_at_idx
  on public.leads (user_id, delivered_at desc);
create index leads_user_id_status_idx
  on public.leads (user_id, status);

-- =============================================================================
-- delivery_log (daily pipeline run audit)
-- =============================================================================
create table public.delivery_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  delivered_at date default current_date,
  leads_count int,
  pipeline_duration_ms int,
  errors text[]
);

create index delivery_log_user_id_delivered_at_idx
  on public.delivery_log (user_id, delivered_at desc);

-- =============================================================================
-- updated_at trigger helper
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

create trigger icp_profiles_set_updated_at
  before update on public.icp_profiles
  for each row
  execute function public.set_updated_at();

-- =============================================================================
-- Auto-create profile row on new auth.users signup
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles        enable row level security;
alter table public.icp_profiles    enable row level security;
alter table public.channels_cache  enable row level security;
alter table public.leads           enable row level security;
alter table public.delivery_log    enable row level security;

-- profiles: a user can read/update their own row
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- icp_profiles: owner-only CRUD
create policy "icp_profiles_select_own"
  on public.icp_profiles for select
  using (auth.uid() = user_id);

create policy "icp_profiles_insert_own"
  on public.icp_profiles for insert
  with check (auth.uid() = user_id);

create policy "icp_profiles_update_own"
  on public.icp_profiles for update
  using (auth.uid() = user_id);

create policy "icp_profiles_delete_own"
  on public.icp_profiles for delete
  using (auth.uid() = user_id);

-- channels_cache: readable by any authenticated user (shared pool).
-- Writes come from the service role during the pipeline, which bypasses RLS.
create policy "channels_cache_select_authenticated"
  on public.channels_cache for select
  to authenticated
  using (true);

-- leads: owner-only read/update (inserts done by service role from pipeline)
create policy "leads_select_own"
  on public.leads for select
  using (auth.uid() = user_id);

create policy "leads_update_own"
  on public.leads for update
  using (auth.uid() = user_id);

create policy "leads_delete_own"
  on public.leads for delete
  using (auth.uid() = user_id);

-- delivery_log: owner-only read
create policy "delivery_log_select_own"
  on public.delivery_log for select
  using (auth.uid() = user_id);
