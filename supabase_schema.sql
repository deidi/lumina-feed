-- ==============================================================================
-- LuminaFeed Supabase Database Schema (v0.2.0 - Cloud-Only)
-- 
-- Run this script in your Supabase Project SQL Editor (https://supabase.com/dashboard)
-- This creates the tables for Host Accounts, Event Settings, Frame Overlays,
-- Guest Sessions (with optional passcode), Photos, RLS Security Policies,
-- and Storage Bucket Config.
-- ==============================================================================

-- 1. Hosts Table (24-hour ephemeral host spaces)
create table if not exists public.hosts (
  id uuid primary key default gen_random_uuid(),
  host_name text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- 2. Events Table (Event ownership, frame configuration, and quota settings)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  host_name text not null references public.hosts(host_name) on delete cascade,
  tagline text default 'Memories Shared in Real-Time',
  date date default current_date,
  moderation_enabled boolean default true,
  auto_approve boolean default false,
  e2ee_enabled boolean default false,
  allow_guest_downloads boolean default true,
  frame_url text,
  frame_config jsonb default '{"enabled": false, "preset": "none", "text": ""}'::jsonb,
  guest_upload_limit integer default 15,
  max_photos integer default 100,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- 3. Guests Table (Cross-device guest attendance, session tokens, passcodes, and upload counts)
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null references public.events(slug) on delete cascade,
  name text not null,
  token text not null,
  pin_hash text,
  upload_count integer default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint unique_event_guest_token unique(event_slug, token),
  constraint unique_event_guest_name unique(event_slug, name)
);

-- 4. Photos Table (Photo metadata, approval status, captions, and frame tags)
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null references public.events(slug) on delete cascade,
  storage_orig_path text not null,
  storage_thumb_path text,
  filename text not null,
  hash text,
  guest_token text,
  guest_name text not null default 'Guest',
  caption text,
  has_frame boolean default false,
  likes_count integer default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  width integer,
  height integer,
  size bigint,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_event_photo_path unique(event_slug, storage_orig_path)
);

-- 5. Migration Alterations (for existing databases created before v1.0.1)
alter table if exists public.events add column if not exists status text not null default 'active';

-- 6. Fast Retrieval Indexes
create index if not exists idx_hosts_name on public.hosts(host_name);
create index if not exists idx_hosts_expires on public.hosts(expires_at);
create index if not exists idx_events_host on public.events(host_name);
create index if not exists idx_events_slug on public.events(slug);
create index if not exists idx_events_expires on public.events(expires_at);
create index if not exists idx_guests_event on public.guests(event_slug);
create index if not exists idx_guests_token on public.guests(token);
create index if not exists idx_photos_event on public.photos(event_slug);
create index if not exists idx_photos_event_status on public.photos(event_slug, status);
create index if not exists idx_photos_guest_token on public.photos(event_slug, guest_token);
create index if not exists idx_photos_path on public.photos(storage_orig_path);

-- 7. Enable Row Level Security (RLS)
alter table public.hosts enable row level security;
alter table public.events enable row level security;
alter table public.guests enable row level security;
alter table public.photos enable row level security;

-- Row Level Security Policies for Anon Key (Active 24-hour records only)
drop policy if exists "Allow all actions for anon on hosts" on public.hosts;
drop policy if exists "Anon read active hosts" on public.hosts;
drop policy if exists "Anon insert hosts" on public.hosts;
drop policy if exists "Anon update hosts" on public.hosts;
drop policy if exists "Anon delete hosts" on public.hosts;

create policy "Anon read active hosts" on public.hosts
  for select using (expires_at > now());

create policy "Anon insert hosts" on public.hosts
  for insert with check (expires_at > now());

create policy "Anon update hosts" on public.hosts
  for update using (expires_at > now()) with check (expires_at > now());

create policy "Anon delete hosts" on public.hosts
  for delete using (true);

drop policy if exists "Allow all actions for anon on events" on public.events;
drop policy if exists "Anon read active events" on public.events;
drop policy if exists "Anon mutate events" on public.events;

create policy "Anon read active events" on public.events
  for select using (expires_at > now());

create policy "Anon mutate events" on public.events
  for all using (expires_at > now()) with check (expires_at > now());

drop policy if exists "Allow all actions for anon on guests" on public.guests;
drop policy if exists "Anon access guests" on public.guests;

create policy "Anon access guests" on public.guests
  for all using (true) with check (true);

drop policy if exists "Allow all actions for anon on photos" on public.photos;
drop policy if exists "Anon access photos" on public.photos;

create policy "Anon access photos" on public.photos
  for all using (true) with check (true);

-- 8. Storage Bucket Setup (luminafeed-photos) with Quota & MIME Constraints
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'luminafeed-photos',
  'luminafeed-photos',
  true,
  5242880, -- 5 MB maximum per photo upload
  array['image/jpeg', 'image/png', 'application/octet-stream']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'application/octet-stream'];

-- Storage RLS Policies for Anon Key
drop policy if exists "Public Access for luminafeed-photos" on storage.objects;
create policy "Public Access for luminafeed-photos" on storage.objects
  for all using (bucket_id = 'luminafeed-photos') with check (bucket_id = 'luminafeed-photos');

-- 9. Automated Cleanup Function for Expired 24-Hour Records
create or replace function public.cleanup_expired_luminafeed_records()
returns integer as $$
declare
  deleted_count integer;
begin
  with deleted as (
    delete from public.hosts
    where expires_at < now()
    returning id
  )
  select count(*) into deleted_count from deleted;
  
  delete from public.events where expires_at < now();

  return deleted_count;
end;
$$ language plpgsql security definer;
