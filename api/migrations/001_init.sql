-- shelf 001 — users, device tokens, items, provider cache.

create table if not exists users (
  id          text primary key,
  email       text unique,
  home_city   text,
  created_at  timestamptz not null default now()
);

-- Device tokens, stored HASHED. The share extension holds the plaintext in the
-- Keychain; a database dump must not be a set of working credentials.
create table if not exists devices (
  token_hash  text primary key,
  user_id     text not null references users(id) on delete cascade,
  name        text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz
);
create index if not exists devices_user_idx on devices (user_id);

-- One-time pairing codes, minted on the server (`node auth.js --pair you@x`)
-- and typed into the app once. Short-lived and single-use.
create table if not exists pair_codes (
  code        text primary key,
  user_id     text not null references users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table if not exists items (
  id              text primary key,
  user_id         text not null references users(id) on delete cascade,

  -- books | restaurants | movies | recipes | unsorted
  list            text not null default 'unsorted',
  -- pending | needs_review | filed | discarded
  status          text not null default 'pending',

  source_url      text,
  source_platform text not null default 'instagram',
  -- Ordinal within one shared reel: a "5 books I read" reel yields 5 items that
  -- share a source_url and differ only here.
  source_ordinal  int not null default 0,

  raw_caption     text,
  raw_media_url   text,
  raw_location    text,
  raw_author      text,
  -- Screenshot shares arrive as bytes, not a URL — there is nothing to fetch
  -- later, so the image has to be parked somewhere until the worker reads it.
  -- CLEARED as soon as the item resolves: this is a queue slot, not storage,
  -- and leaving base64 JPEGs in the row forever would make every list query
  -- drag them along. The extension downscales before upload.
  raw_image_b64   text,
  raw_image_type  text,

  title           text,
  subtitle        text,
  note            text,
  image_url       text,
  -- {isbn, openlibrary_key, tmdb_id, place_id, address, lat, lng, recipe_url}
  canonical       jsonb not null default '{}'::jsonb,

  confidence      real,
  resolver        text,          -- which link in the chain produced the caption
  enriched        boolean not null default false,
  attempts        int not null default 0,
  last_error      text,

  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  filed_at        timestamptz
);

create index if not exists items_user_list_idx on items (user_id, list, status);
-- The drain picks up pending work oldest-first.
create index if not exists items_pending_idx on items (status, created_at)
  where status = 'pending';
-- Re-sharing the same reel must update, never duplicate.
create unique index if not exists items_source_uniq
  on items (user_id, source_url, source_ordinal);

-- Provider lookups, cached by (provider, key). MISSES ARE CACHED TOO: a
-- "searched, found nothing" costs exactly as much as a hit, and not storing it
-- is how a metered API gets billed twice for the same question. `found` is the
-- flag; a null payload with found=false is a real, reusable answer.
create table if not exists provider_cache (
  provider    text not null,
  cache_key   text not null,
  found       boolean not null,
  payload     jsonb,
  created_at  timestamptz not null default now(),
  primary key (provider, cache_key)
);
