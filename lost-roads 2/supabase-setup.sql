-- Lost Roads: accounts, cloud saves, postcards and the leaderboard.
-- In Supabase, open SQL Editor, paste this whole file, and click Run. It's safe to run again.

-- One row per player: their username and their furthest journey
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  best_km numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- Each player's saved journey, stats and settings
create table if not exists public.saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Each player's postcards
create table if not exists public.cards (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Lock everything down: players can only touch their own saves and postcards,
-- and anyone can read the leaderboard (usernames and distances only).
alter table public.profiles enable row level security;
alter table public.saves enable row level security;
alter table public.cards enable row level security;

drop policy if exists "leaderboard is public" on public.profiles;
create policy "leaderboard is public" on public.profiles for select using (true);

drop policy if exists "players manage their own save" on public.saves;
create policy "players manage their own save" on public.saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "players manage their own postcards" on public.cards;
create policy "players manage their own postcards" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Make a profile automatically when someone creates an account
create or replace function public.handle_new_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_new_player on auth.users;
create trigger on_new_player
  after insert on auth.users
  for each row execute function public.handle_new_player();

-- The game calls this to record a distance. It only ever raises your best, never lowers it.
create or replace function public.submit_best(km numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set best_km = greatest(best_km, least(km, 100000)),
         updated_at = now()
   where id = auth.uid();
$$;

revoke all on function public.submit_best(numeric) from public, anon;
grant execute on function public.submit_best(numeric) to authenticated;
