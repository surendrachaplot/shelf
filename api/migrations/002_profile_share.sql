-- shelf 002 — who you are, and how a shelf leaves your phone.
--
-- Three ideas, one migration, because they are one feature: a shelf you share
-- is a part of yourself, so it needs a person attached to it, a link that
-- carries it, and a way to hand it to someone directly.

-- ── the person ───────────────────────────────────────────────────────────────
-- `handle` is the identity everywhere: the URL, the ex-libris mark, the string
-- you type to send someone something. Lowercase in the column, not merely in
-- the application, so two people cannot own "Suren" and "suren".
alter table users add column if not exists handle        text;
alter table users add column if not exists display_name  text;
alter table users add column if not exists bio           text;
-- Where the ex-libris mark comes from. Derived from the handle by default, but
-- stored so that changing your handle does not silently change your mark —
-- people recognise the plate, and it should only move when you ask it to.
alter table users add column if not exists plate_seed    text;
alter table users add column if not exists public_shelves boolean not null default false;

create unique index if not exists users_handle_uniq on users (lower(handle));

-- ── links ────────────────────────────────────────────────────────────────────
-- One row per shared thing. Deliberately NOT "make every item public": a link
-- is a deliberate act, it is revocable, and until one exists nothing of yours
-- is reachable. `kind` says what the target means, so one table serves an item,
-- a shelf and a whole profile rather than three near-identical ones.
create table if not exists share_links (
  code        text primary key,             -- short, URL-safe, unguessable
  user_id     text not null references users(id) on delete cascade,
  kind        text not null,                -- item | shelf | profile
  target      text,                         -- item id, or list name, or null
  note        text,                         -- what you said when you sent it
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  views       int not null default 0
);
create index if not exists share_links_user_idx on share_links (user_id, created_at desc);
-- One live link per (user, kind, target): re-sharing the same shelf should hand
-- back the link you already gave people, not mint a second one that splits the
-- view count and leaves the first quietly alive after you revoke the second.
create unique index if not exists share_links_target_uniq
  on share_links (user_id, kind, coalesce(target, '')) where revoked_at is null;

-- ── sends ────────────────────────────────────────────────────────────────────
-- A link handed directly to another shelf user. It lands in their app, they
-- accept or decline, and accepting copies the item onto their shelf — it does
-- not share a row. Two people who saved the same restaurant have two opinions
-- of it, and a shared row would make one person's note overwrite the other's.
create table if not exists sends (
  id          text primary key,
  from_user   text not null references users(id) on delete cascade,
  to_user     text not null references users(id) on delete cascade,
  code        text references share_links(code) on delete set null,
  note        text,
  status      text not null default 'sent',  -- sent | accepted | declined
  created_at  timestamptz not null default now(),
  acted_at    timestamptz
);
create index if not exists sends_to_idx on sends (to_user, status, created_at desc);
-- The same person sending you the same thing twice is one notification.
create unique index if not exists sends_dedupe_uniq
  on sends (from_user, to_user, code) where status = 'sent';

-- ── items added by hand ──────────────────────────────────────────────────────
-- Search-and-add produces items with no reel behind them. `source_url` is null
-- for those, and the 001 unique index is on (user_id, source_url, ordinal) —
-- in Postgres NULLs are distinct, so two hand-added items never collide, which
-- is the behaviour we want. What we also want is not adding the SAME catalogue
-- entry twice, and that is what this covers.
alter table items add column if not exists added_by text not null default 'share';
create unique index if not exists items_canonical_uniq
  on items (user_id, list, (canonical->>'key'))
  where canonical ? 'key';
