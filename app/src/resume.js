// resume.js — what to do, at launch, with a row that says "Working it out…".
//
// ── THE BUG THIS FILE EXISTS FOR ────────────────────────────────────────────
//
// Reported as "why is everything stuck on working it out". It was, and nothing
// in the app was ever going to un-stick it.
//
// A shared reel becomes a row with `status: "pending"` BEFORE any network
// happens — that part is deliberate and right: the row is the receipt, so a
// share is on your shelf even if resolving fails. `drainShares` then resolves
// each one, and on failure writes `status: "unread"` with the reason, which is
// the state that carries a "Read again" button.
//
// But a resolve that neither succeeds NOR fails leaves the row exactly as it
// was. And that is the common case, not the rare one: iOS suspends an app the
// moment you switch away, so sharing six reels, opening shelf, and going back
// to Instagram after two of them freezes the other four mid-flight. There is
// no error, so nothing is written. The loop simply stops existing.
//
// On the next launch `drainShares` reads the QUEUE — which is empty, because
// those shares were taken off it — and returns. Nothing looks at the rows. So
// "Working it out…" is a TERMINAL STATE in practice, on a row that cannot be
// opened, cannot be retried, and cannot be deleted, because the pending branch
// of the pile row renders text instead of a button.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
//
// A PROCESS THAT HAS JUST STARTED CANNOT BE IN THE MIDDLE OF ANYTHING. Every
// pending row seen at launch was interrupted, by definition — there is no
// timeout to guess at and no clock to consult. So each one is either picked up
// again or given a reason, and neither outcome is "leave it saying it is
// working on it".
//
// Pure, and separate from App.tsx, so the decision can be asserted with
// fixtures instead of by killing an app at the right moment on a phone.

/** A screenshot's file lives in the App Group container, which is emptied
 *  after every drain. Its path is not something a later launch can re-read. */
const fromLink = (it) => typeof it.source_url === "string" && /^https?:\/\//i.test(it.source_url);

/**
 * Split the pending rows into the ones worth trying again and the ones that
 * can only be explained.
 *
 * `max` bounds the retries because a launch is not the place to make thirty
 * network calls: the rest are handed the same honest reason as the give-ups
 * and keep their "Read again" button, which is a person's own retry.
 */
export function resumePlan(items, { max = 6 } = {}) {
  const pending = (items || []).filter((it) => it && it.status === "pending");
  const retry = [], giveUp = [];
  for (const it of pending) {
    if (fromLink(it) && retry.length < max) retry.push(it);
    else giveUp.push(it);
  }
  return { pending, retry, giveUp };
}

/**
 * What a given-up row says. It has to state what happened AND what to do,
 * because the row it lands on carries a button that does exactly that.
 *
 * §8: never leave somebody guessing. "Reading was interrupted" is a fact;
 * "Read again" is the way out; and a screenshot says something different
 * because for a screenshot there is genuinely no way back — the picture it was
 * made from is gone, and offering to re-read it would be a button that fails.
 */
export function whyStopped(item) {
  return fromLink(item)
    ? "Reading this was interrupted — tap Read again"
    : "Reading this screenshot was interrupted, and the picture it came from is no longer here. Import it again from your photos.";
}
