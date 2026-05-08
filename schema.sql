-- FeelReply — Supabase Schema
-- Run this entire file in: Supabase → SQL Editor → New query → Run

-- ── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id              uuid references auth.users on delete cascade primary key,
  business_name   text,
  google_maps_url text,
  whatsapp_number text,
  notification_email text,
  plan               text default 'free',
  plan_expires_at    timestamptz,
  stripe_customer_id text,
  tone_preference    text default 'professional',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Add plan_expires_at if upgrading an existing database
alter table public.profiles add column if not exists plan_expires_at timestamptz;

create table if not exists public.reviews (
  id            uuid default gen_random_uuid() primary key,
  user_id       uuid references auth.users on delete cascade not null,
  reviewer_name text not null,
  rating        smallint check (rating between 1 and 5) not null,
  review_text   text,
  review_date   timestamptz default now(),
  status        text default 'pending' check (status in ('pending', 'replied')),
  created_at    timestamptz default now()
);

create table if not exists public.reply_drafts (
  id          uuid default gen_random_uuid() primary key,
  review_id   uuid references public.reviews on delete cascade not null,
  user_id     uuid references auth.users on delete cascade not null,
  draft_text  text not null,
  status      text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz default now()
);

create table if not exists public.whatsapp_logs (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users on delete cascade not null,
  message_type text not null,
  content      text not null,
  sent_at      timestamptz default now()
);

-- ── Row Level Security ───────────────────────────────────────────────────────

alter table public.profiles      enable row level security;
alter table public.reviews       enable row level security;
alter table public.reply_drafts  enable row level security;
alter table public.whatsapp_logs enable row level security;

create policy "own profile"  on public.profiles      for all using (auth.uid() = id)      with check (auth.uid() = id);
create policy "own reviews"  on public.reviews       for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own drafts"   on public.reply_drafts  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own logs"     on public.whatsapp_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Auto-create profile on signup ───────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
