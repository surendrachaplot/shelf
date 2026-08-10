// worker.js — drains the pending queue.
//
// Everything slow lives here and nowhere else: fetching Instagram, calling
// Claude, hitting the catalogue providers. The request path writes a row and
// returns; this is what makes the share sheet feel instant, and it is the one
// architectural rule of this service.
//
// Run as a loop (`node worker.js`), a single pass (`node worker.js --once`), or
// from cron. Concurrency is bounded by `claimNextPending`'s
// `for update skip locked`, so more than one is safe.
import { isMain } from "./ismain.js";
import { migrate, query } from "./db.js";
import { claimNextPending, writeResolved, markFailed } from "./items.js";
import { resolveShare } from "./resolve.js";
import { classifyCaption, classifyImage } from "./classify.js";
import { enrich } from "./enrich/index.js";

async function homeCityOf(userId) {
  try {
    const r = await query(`select home_city from users where id = $1`, [userId]);
    return r.rows[0]?.home_city || null;
  } catch (_) { return null; }
}

export async function resolveOne(row) {
  let envelope;
  let items;

  if (row.raw_image_b64) {
    // The screenshot path — no URL to fetch, straight to vision.
    envelope = { caption: "", imageUrl: null, locationTag: null, authorHandle: null,
                 outboundUrls: [], via: "screenshot" };
    items = await classifyImage(row.raw_image_b64, row.raw_image_type, row.list);
    // Drop the bytes the moment they have been read, success or not — a retry
    // that needs them will have already failed before this line.
    await query(`update items set raw_image_b64 = null where id = $1`, [row.id]);
  } else {
    envelope = await resolveShare(row.source_url);
    items = envelope.caption ? await classifyCaption(envelope, row.list) : [];
  }

  const homeCity = await homeCityOf(row.user_id);
  const enriched = [];
  for (const it of items) {
    enriched.push(await enrich(it, { outboundUrls: envelope.outboundUrls, homeCity }));
  }
  await writeResolved(row.id, envelope, enriched);
  return { id: row.id, via: envelope.via, count: enriched.length };
}

export async function drain(limit = 5) {
  const rows = await claimNextPending(limit);
  const done = [];
  for (const row of rows) {
    try {
      done.push(await resolveOne(row));
    } catch (e) {
      // One bad share must never stop the queue. After 4 attempts the item
      // stops being retried and shows up in the Inbox with whatever we have,
      // which is a visible outcome rather than a row stuck on 'pending'.
      console.error(`[worker] ${row.id} failed:`, e.message);
      await markFailed(row.id, e.message);
    }
  }
  return done;
}

if (isMain(import.meta.url)) {
  await migrate();
  const once = process.argv.includes("--once");
  const every = Number(process.env.WORKER_INTERVAL_MS || 5000);
  do {
    const done = await drain();
    if (done.length) console.log(`[worker] resolved ${done.length}:`, done.map((d) => `${d.id}(${d.via},${d.count})`).join(" "));
    if (!once) await new Promise((r) => setTimeout(r, done.length ? 250 : every));
  } while (!once);
  process.exit(0);
}
