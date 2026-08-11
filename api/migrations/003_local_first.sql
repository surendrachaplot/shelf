-- 003_local_first.sql — the server stops owning your shelves.
--
-- Everything you save now lives on the phone. This service resolves a link and
-- hands the answer back; it keeps nothing. The ONE exception is deliberate and
-- opt-in: when you tap Share, that item or that shelf is uploaded as a frozen
-- snapshot so somebody else can open a link. Nothing else ever leaves the
-- device, and revoking deletes the snapshot outright.
--
-- A SNAPSHOT, not a view. What you published is what they see, forever, even
-- after you rename the thing or move it to another shelf — because a link
-- somebody saved should not change under them, and because a live view would
-- mean the server holding your current shelves, which is exactly what this
-- migration exists to stop.

create table if not exists published (
  code        text primary key,
  kind        text not null,               -- profile | shelf | item
  target      text,                         -- which shelf, when kind = 'shelf'
  payload     jsonb not null,               -- the frozen snapshot the page renders
  note        text,                         -- what the sender said when handing it over
  views       int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists published_created_idx on published (created_at desc);

-- The legacy tables (users, devices, pair_codes, items) are intentionally NOT
-- dropped here. There is real data in `items` — films with trailers — and the
-- app pulls it onto the device once before anything is destroyed. Dropping
-- them is a separate migration, written after the migration has been seen to
-- work on the actual phone rather than in a plan.
