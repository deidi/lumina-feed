-- ==============================================================================
-- LuminaFeed Supabase Database Schema
-- 
-- Run this script in your Supabase Project SQL Editor (https://supabase.com/dashboard)
-- This creates the tables for Host Details, Event Folder Ownership, 24-Hour TTL,
-- and Cross-Device Guest Directory.
-- ==============================================================================

-- 1. Hosts Table (24-hour ephemeral host spaces)
create table if not exists public.hosts (
  id uuid primary key default gen_random_uuid(),
  host_name text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- 2. Events Table (Event ownership linked to hosts)
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  host_name text not null references public.hosts(host_name) on delete cascade,
  tagline text default 'Memories Shared in Real-Time',
  date date default current_date,
  moderation_enabled boolean default true,
  auto_approve boolean default false,
  guest_upload_limit integer default 20,
  max_photos integer default 100,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- 3. Guests Table (Cross-device guest attendance and upload counts)
create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null references public.events(slug) on delete cascade,
  name text not null,
  token text not null,
  upload_count integer default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  constraint unique_event_guest_token unique(event_slug, token)
);

-- 4. Photo metadata is stored separately from Storage so guest attribution
-- survives page reloads, different devices, and missed real-time messages.
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  event_slug text not null references public.events(slug) on delete cascade,
  storage_orig_path text not null,
  storage_thumb_path text,
  filename text not null,
  hash text,
  guest_token text,
  guest_name text not null default 'Guest',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  width integer,
  height integer,
  size bigint,
  mime_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unique_event_photo_path unique(event_slug, storage_orig_path)
);

-- 5. Fast Retrieval Indexes
create index if not exists idx_hosts_name on public.hosts(host_name);
create index if not exists idx_hosts_expires on public.hosts(expires_at);
create index if not exists idx_events_host on public.events(host_name);
create index if not exists idx_events_slug on public.events(slug);
create index if not exists idx_events_expires on public.events(expires_at);
create index if not exists idx_guests_event on public.guests(event_slug);
create index if not exists idx_guests_token on public.guests(token);
create index if not exists idx_photos_event on public.photos(event_slug);
create index if not exists idx_photos_guest_token on public.photos(event_slug, guest_token);
create index if not exists idx_photos_path on public.photos(storage_orig_path);

-- 6. Enable Row Level Security (RLS)
alter table public.hosts enable row level security;
alter table public.events enable row level security;
alter table public.guests enable row level security;
alter table public.photos enable row level security;

-- 6. Open Permissive Policies for Anon Key
-- (Security is enforced client-side via PIN verification and host scoping)
drop policy if exists "Allow all actions for anon on hosts" on public.hosts;
create policy "Allow all actions for anon on hosts" on public.hosts
  for all using (true) with check (true);

drop policy if exists "Allow all actions for anon on events" on public.events;
create policy "Allow all actions for anon on events" on public.events
  for all using (true) with check (true);

drop policy if exists "Allow all actions for anon on guests" on public.guests;
create policy "Allow all actions for anon on guests" on public.guests
  for all using (true) with check (true);

drop policy if exists "Allow all actions for anon on photos" on public.photos;
create policy "Allow all actions for anon on photos" on public.photos
  for all using (true) with check (true);

-- 7. Optional: Automated Cleanup Function for Expired Records
create or replace function public.cleanup_expired_luminafeed_records()
returns integer as $$
declare
  deleted_count integer;
begin
  -- Deleting from hosts automatically cascades to events and guests
  with deleted as (
    delete from public.hosts
    where expires_at < now()
    returning id
  )
  select count(*) into deleted_count from deleted;
  
  -- Also delete orphaned events if any exist past expires_at
  delete from public.events where expires_at < now();

  return deleted_count;
end;
$$ language plpgsql security definer;
