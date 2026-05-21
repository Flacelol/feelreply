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
  reply_language     text default 'en',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Add plan_expires_at if upgrading an existing database
alter table public.profiles add column if not exists plan_expires_at timestamptz;
-- Add reply_language if upgrading an existing database
alter table public.profiles add column if not exists reply_language text default 'en';

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
create policy "own logs"     on public.whatsapp_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Reviews: read/update/delete own rows freely; INSERT requires active subscription
create policy "select own reviews" on public.reviews for select using (auth.uid() = user_id);
create policy "update own reviews" on public.reviews for update using (auth.uid() = user_id);
create policy "delete own reviews" on public.reviews for delete using (auth.uid() = user_id);
create policy "insert reviews — subscribers only" on public.reviews
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and plan is not null
        and plan != 'free'
        and (plan_expires_at is null or plan_expires_at > now())
    )
  );

-- Reply drafts: same pattern
create policy "select own drafts" on public.reply_drafts for select using (auth.uid() = user_id);
create policy "update own drafts" on public.reply_drafts for update using (auth.uid() = user_id);
create policy "delete own drafts" on public.reply_drafts for delete using (auth.uid() = user_id);
create policy "insert drafts — subscribers only" on public.reply_drafts
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles
      where id = auth.uid()
        and plan is not null
        and plan != 'free'
        and (plan_expires_at is null or plan_expires_at > now())
    )
  );

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

-- ── Protect subscription fields from self-modification ───────────────────────
-- auth.uid() is NULL when called via service role (Stripe webhook) → allow
-- auth.uid() is non-null when called by a logged-in user → block plan changes

create or replace function public.protect_plan_fields()
returns trigger language plpgsql security definer as $$
begin
  if auth.uid() is not null then
    new.plan               := old.plan;
    new.plan_expires_at    := old.plan_expires_at;
    new.stripe_customer_id := old.stripe_customer_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_plan_fields_trigger on public.profiles;
create trigger protect_plan_fields_trigger
  before update on public.profiles
  for each row execute function public.protect_plan_fields();
