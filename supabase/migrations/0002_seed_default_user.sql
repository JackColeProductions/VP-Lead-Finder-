-- Seed the single default user for this local single-user tool.
--
-- LeadFlow v0.1 runs without auth. We drop the foreign key from profiles.id
-- to auth.users so we can insert a hardcoded UUID, then seed one profile row.
-- All backend routes use the service-role Supabase client to bypass RLS and
-- reference this user id via DEFAULT_USER_ID in lib/constants.ts.

alter table public.profiles
  drop constraint if exists profiles_id_fkey;

insert into public.profiles (
  id,
  email,
  subscription_tier,
  onboarding_completed
) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'me@leadflow.local',
  'pro',
  false
)
on conflict (id) do nothing;
