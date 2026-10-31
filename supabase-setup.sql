-- Lost Roads: usernames, cloud saves, postcards and the leaderboard.
-- No email addresses anywhere: the game keeps its own usernames and passwords
-- (passwords are stored scrambled with bcrypt, never as plain text).
--
-- In Supabase, open SQL Editor, click New query, paste this whole file, and click Run.
-- It's safe to run again.

create extension if not exists pgcrypto with schema extensions;

-- Players: a username, a scrambled password and their furthest journey
create table if not exists public.lr_players (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  pass_hash text not null,
  best_km numeric not null default 0,
  fails int not null default 0,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lr_players_username on public.lr_players (lower(username));

-- Who is signed in where: each device gets a random token
create table if not exists public.lr_sessions (
  token uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.lr_players (id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz not null default now()
);

-- Each player's saved journey, stats and settings
create table if not exists public.lr_saves (
  player_id uuid primary key references public.lr_players (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Each player's postcards
create table if not exists public.lr_cards (
  player_id uuid not null references public.lr_players (id) on delete cascade,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (player_id, id)
);

-- Lock the tables. Nobody can read or change them directly, not even with the
-- site's public key. The game only goes through the functions below.
alter table public.lr_players enable row level security;
alter table public.lr_sessions enable row level security;
alter table public.lr_saves enable row level security;
alter table public.lr_cards enable row level security;

-- ---------------------------------------------------------------------------
-- Signing up, in and out
-- ---------------------------------------------------------------------------
create or replace function public.lr_player(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid;
begin
  update lr_sessions set used_at = now()
   where token = p_token and used_at > now() - interval '180 days'
  returning player_id into pid;
  if pid is null then raise exception 'signed_out'; end if;
  return pid;
end;
$$;

create or replace function public.lr_sign_up(p_username text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare pid uuid; tok uuid;
begin
  p_username := trim(p_username);
  if p_username !~ '^[A-Za-z0-9_-]{3,20}$' then raise exception 'bad_username'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'short_password'; end if;
  if exists (select 1 from lr_players where lower(username) = lower(p_username)) then raise exception 'username_taken'; end if;
  insert into lr_players (username, pass_hash)
  values (p_username, crypt(p_password, gen_salt('bf', 8)))
  returning id into pid;
  insert into lr_sessions (player_id) values (pid) returning token into tok;
  return json_build_object('token', tok, 'username', p_username);
exception when unique_violation then
  raise exception 'username_taken';
end;
$$;

create or replace function public.lr_sign_in(p_username text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare p lr_players; tok uuid;
begin
  select * into p from lr_players where lower(username) = lower(trim(p_username));
  if p.id is null then raise exception 'wrong_login'; end if;
  -- slow down guessing: after 10 wrong passwords, wait 10 minutes
  if p.fails >= 10 and p.failed_at > now() - interval '10 minutes' then raise exception 'too_many_tries'; end if;
  if p.pass_hash <> crypt(coalesce(p_password, ''), p.pass_hash) then
    update lr_players
       set fails = case when failed_at > now() - interval '10 minutes' then fails + 1 else 1 end,
           failed_at = now()
     where id = p.id;
    return json_build_object('error', 'wrong_login');
  end if;
  update lr_players set fails = 0 where id = p.id;
  insert into lr_sessions (player_id) values (p.id) returning token into tok;
  return json_build_object('token', tok, 'username', p.username);
end;
$$;

create or replace function public.lr_sign_out(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from lr_sessions where token = p_token;
$$;

-- ---------------------------------------------------------------------------
-- Saves and postcards
-- ---------------------------------------------------------------------------
create or replace function public.lr_get_save(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid := lr_player(p_token); d jsonb;
begin
  select data into d from lr_saves where player_id = pid;
  return d;
end;
$$;

create or replace function public.lr_put_save(p_token uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid := lr_player(p_token);
begin
  insert into lr_saves (player_id, data, updated_at) values (pid, p_data, now())
  on conflict (player_id) do update set data = excluded.data, updated_at = now();
end;
$$;

create or replace function public.lr_get_cards(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid := lr_player(p_token);
begin
  return coalesce((select jsonb_agg(data order by created_at desc) from lr_cards where player_id = pid), '[]'::jsonb);
end;
$$;

create or replace function public.lr_put_card(p_token uuid, p_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid := lr_player(p_token);
begin
  if (select count(*) from lr_cards where player_id = pid) >= 200 then raise exception 'too_many_cards'; end if;
  insert into lr_cards (player_id, id, data) values (pid, p_id, p_data)
  on conflict (player_id, id) do nothing;
end;
$$;

create or replace function public.lr_delete_card(p_token uuid, p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid := lr_player(p_token);
begin
  delete from lr_cards where player_id = pid and id = p_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Leaderboard
-- ---------------------------------------------------------------------------
-- Only ever raises your best, never lowers it
create or replace function public.lr_submit_best(p_token uuid, p_km numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare pid uuid := lr_player(p_token);
begin
  update lr_players
     set best_km = greatest(best_km, least(p_km, 100000)), updated_at = now()
   where id = pid and p_km > best_km;
end;
$$;

-- Anyone can see the leaderboard: usernames and distances only
create or replace function public.lr_leaderboard(p_limit int default 50)
returns table (username text, best_km numeric)
language sql
security definer
set search_path = public
as $$
  select username, best_km from lr_players
   where best_km > 0
   order by best_km desc, updated_at asc
   limit least(greatest(p_limit, 1), 200);
$$;

-- Only these functions can be called from the website
revoke all on function public.lr_player(uuid) from public, anon, authenticated;
revoke all on function public.lr_sign_up(text, text) from public;
revoke all on function public.lr_sign_in(text, text) from public;
revoke all on function public.lr_sign_out(uuid) from public;
revoke all on function public.lr_get_save(uuid) from public;
revoke all on function public.lr_put_save(uuid, jsonb) from public;
revoke all on function public.lr_get_cards(uuid) from public;
revoke all on function public.lr_put_card(uuid, text, jsonb) from public;
revoke all on function public.lr_delete_card(uuid, text) from public;
revoke all on function public.lr_submit_best(uuid, numeric) from public;
revoke all on function public.lr_leaderboard(int) from public;

grant execute on function public.lr_sign_up(text, text) to anon, authenticated;
grant execute on function public.lr_sign_in(text, text) to anon, authenticated;
grant execute on function public.lr_sign_out(uuid) to anon, authenticated;
grant execute on function public.lr_get_save(uuid) to anon, authenticated;
grant execute on function public.lr_put_save(uuid, jsonb) to anon, authenticated;
grant execute on function public.lr_get_cards(uuid) to anon, authenticated;
grant execute on function public.lr_put_card(uuid, text, jsonb) to anon, authenticated;
grant execute on function public.lr_delete_card(uuid, text) to anon, authenticated;
grant execute on function public.lr_submit_best(uuid, numeric) to anon, authenticated;
grant execute on function public.lr_leaderboard(int) to anon, authenticated;

-- Make the website see the new functions straight away
notify pgrst, 'reload schema';
