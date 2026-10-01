# shelf vs mymind — the plan to be worth paying for

Written 2026-10-01. Grounded in what shelf actually is today (see HANDOVER.md)
and in what mymind actually ships, taken from its pricing page and from 2026
reviews rather than from memory. Every phase below ends with the check that
proves it, same discipline as the rest of this repo.

---

## 0. The bet, in one paragraph

**mymind saves and tags. shelf resolves.**

mymind is the most beautiful save-everything app on the market. You give it a
photo of a book and it gives you back a pretty card tagged `book`, `blue`,
`design`. That is genuinely useful and it is also where it stops: the card is a
souvenir of the thing, not the thing.

shelf already does the harder half. You give it a reel and it comes back with
*Piranesi, Susanna Clarke, 2020*, a cover, an ISBN, and a map pin for the
bookshop in the same video. `api/resolve.js` → `api/classify.js` →
`api/enrich/` is a pipeline that turns a scrap into an **entity with identity**:
an ISBN, a TMDB id, an OSM node, a recipe's schema.org markup.

That difference is the whole product. A pile you can admire is worth $6.99 to
some people. A pile that knows what each thing IS — and can therefore tell you
where to watch it, whether it is open now, which library has it — is worth more
than that, to more people, and is very hard to copy because it is a year of
unglamorous parser and prompt work, not a UI.

**Positioning: mymind is a beautiful memory. shelf is a memory that can act.**

---

## 1. The decision everything waits on

**You cannot sell a subscription to shelf as it is today.** There are no
accounts, no server-side rows, and no sync: deleting the app deletes everything
(which is exactly what happened on 2026-08-22). Nobody pays monthly for
something that lives on one device and can evaporate, and we would be charging
for a thing we do not hold up our end of.

So the gate is: **what do we put on a server, and on whose terms?**

| Option | What it buys | What it costs |
|---|---|---|
| **A. End-to-end encrypted sync** (recommended) | Second device, real backup, account to bill, "we literally cannot read your shelf" | Key management, recovery-code UX, no server-side AI on stored items |
| B. Ordinary cloud accounts | Simplest, server-side search/AI over everything | Throws away the privacy claim, which is half of why anyone leaves mymind |

**Recommendation: A, with one deliberate crack.** Items are stored encrypted;
the *resolve* step still happens server-side on the way in (it already does,
and it stores nothing — `api/` is stateless today). So Claude sees a reel URL
for four seconds and never sees your shelf. That is a stronger promise than
mymind's "your data is encrypted", because mymind holds the keys and runs AI
over your library on their machines.

**The marketing line writes itself: "We can't read your shelf. Ask them if they
can read yours."**

Non-negotiables that come with charging money:
- Export everything, one tap, JSON + a readable HTML archive. Never hostage.
- A recovery code, printed at signup, that we cannot regenerate — said plainly.
- A real deletion: account gone means rows gone, not a flag.
- Status page and a human reply inside 24h. Paying changes the contract.

---

## 2. Feature map — every mymind feature, matched and beaten

| mymind | shelf today | Plan | How we beat it |
|---|---|---|---|
| **Save anything** (images, links, notes, quotes, products, screenshots) | Reels, screenshots, camera roll, manual add | Add: plain notes, PDFs, voice memos, any URL, email-in address | Reels and TikTok are first-class. mymind cannot read a video's caption at all. |
| **AI auto-tags** | Six fixed shelves + confidence | Keep shelves, add free tags from `classify.js` (it already extracts `search_hints`) | Reviewers' complaint is **tags too broad for specialists**. We tag from a resolved entity — "Susanna Clarke", "2020", "fantasy", "Peckham", "south indian" are facts, not guesses. |
| **No folders, one visual board** | Six shelves + the pile | Add an "Everything" board; shelves become one lens among several | Shelves are a *lens*, not a prison: an item can be a book AND a gift idea. |
| **Visual search / OCR in images** | Vision resolve on screenshots (`api/frames.js`) | Store extracted text with the item; index it | Already reading screenshots end-to-end. Extend OCR text into the search index — cheap, we have the pixels once. |
| **Associative search** (colour, brand, keyword, date) | `find.js` — titles, authors, cities, cuisines, years, notes, ranked, typo-tolerant, instant, local | Add colour + dominant-palette, source, date ranges | Ours is **instant and offline** because it runs on the device against a file in memory. Theirs is a network round trip. |
| **"Same Vibe"** (visually similar) | — | Phase 3: on-device embedding of the cover/photo | Fine to match. Not a differentiator either way. |
| **AI summaries of articles** ($12.99 tier) | — | Phase 2, and **not paywalled separately** | Their own reviews call gating this "a core feature behind the top tier". Include it in one plan and say so. |
| **Reading mode / article backup** ($12.99 tier) | — | Phase 2: save readable text at save time | Link rot is the real enemy; we snapshot on save, like they do, but at every tier. |
| **PDF analysis** | — | Phase 3 | Parity. |
| **Serendipity** (resurfaces forgotten items) | — | Phase 2: "On this shelf, a year ago" + a weekly digest | Ours can be **actionable**: "that restaurant you saved is 400m away and open now". A memory that knows where you are beats a memory that is merely nostalgic. |
| **Bidirectional links** | — | Phase 3, automatic: same author, same city, same director | Theirs is manual linking. Ours comes free from resolved entities — no one has to maintain it. |
| **Spaces** | — | Phase 3: saved searches as boards | Reviewers say Spaces are "too passive — you cannot drag an item in". Ours: a board is a saved search **plus** hand-pinned items. Fixes their exact complaint. |
| **Privacy** | Nothing on the server at all | E2E sync | Stronger, and provable: the server cannot decrypt. Publish the threat model. |
| **Browser extension** | — | Phase 2 — this is how desktop people save | Table stakes. Must have it to be taken seriously. |
| **Public sharing** | **Already shipped** (`api/publish.js`, revocable) | Polish it | mymind has **no public sharing at all**. A shelf you can hand someone is our growth loop and they have chosen not to have one. |
| **API / team features** | — | Phase 4, maybe never | Their reviews list "no API" as a gap. An export + webhook is cheap goodwill. |
| **Free plan** | Everything is free now | Free tier stays, capped | mymind has **no permanent free plan**. A real free tier is how we get tried at all. |

---

## 3. The five things mymind structurally cannot do

These are where the money is. Not polish — different product.

1. **Reels and short video.** Instagram/TikTok is where recommendations now
   live. shelf reads the caption, the on-screen text and the frame
   (`frames.js` + vision). mymind saves a thumbnail.
2. **The thing becomes real.** Books get an ISBN, films a TMDB id, places a map
   pin with opening hours. From there: "where can I watch this", "is it open
   now", "which library has it". `api/facts.js` already builds platform-correct
   map links. **This is the moat.**
3. **One reel, several things.** "5 books I read this month" becomes five
   items sharing a source. Already built.
4. **Shareable shelves.** Publish, revoke, count the opens. Already built. A
   private app with a public surface — mymind refuses the second half.
5. **Place-aware recall.** A restaurant shelf that surfaces when you are near
   it is worth more than a restaurant shelf you have to remember to open.

---

## 4. What "robust enough to charge for" means here

The repo already has the unglamorous half of this and it is worth naming,
because it is what makes a paid promise keepable:

- Atomic writes, backups of unreadable files, salvage out of truncated JSON
  (`store.ts`) — written after an outage that looked like data loss.
- An update that a binary cannot run is refused before it publishes
  (`update-safety.mjs`, `native-rules.mjs`).
- A design gate that reads every painting file off the disk.
- 347 tap targets measured on the live layout, every screen rendered.

What is missing before anyone's card is charged:

- [ ] Sync + accounts (§1) with a tested restore, not just a tested backup
- [ ] Billing (Stripe or RevenueCat if we want App Store IAP — Apple will
      require IAP for a subscription unlocking in-app features)
- [ ] `SHELF_APP_KEY` set; **the repo is still public and its Actions logs have
      carried item titles** — close both before launch
- [ ] Error reporting (Sentry) — today a crash on a stranger's phone is invisible
- [ ] Android build fixed (`EAS_BUILD_UNKNOWN_GRADLE_ERROR`, unread)
- [ ] A paid Expo plan — the free tier's build quota has already blocked
      shipping for two weeks of this project's life

---

## 5. Pricing

mymind: no free plan, ~$6.99/mo base, **$12.99/mo or $129/yr** for the AI tier.
Their reviews punish the gating. So:

| Plan | Price | What |
|---|---|---|
| **Free** | £0 | 100 items, all six shelves, resolve, Find, share a shelf. Not a trial — a real thing that keeps working. |
| **shelf** | **£5/mo or £45/yr** | Unlimited items, E2E sync across devices, article backup, summaries, Serendipity, browser extension. **Every AI feature.** |
| **shelf for two** | £8/mo | Same, two people, shared shelves. |

Undercut them, include what they gate, and never ship a feature whose purpose
is to make the cheaper plan annoying.

---

## 6. Phases, each with the check that proves it

**Phase 1 — Earn the right to charge (4–6 weeks).**
Sync + accounts (E2E), export, billing, Sentry, Android fixed, repo private.
*Check:* install on a second phone, restore from a recovery code, confirm the
server holds only ciphertext (`psql` and look), cancel a subscription and watch
access end.

**Phase 2 — Parity where it matters (4 weeks).**
Browser extension, any-URL save, article text snapshot + reading mode, AI
summary, Serendipity digest, OCR text into the index.
*Check:* save 50 mixed URLs from a laptop; 90%+ resolve to a named entity;
every one still readable after the source 404s.

**Phase 3 — The things they cannot copy (6 weeks).**
Automatic entity links, boards = saved search + pins, "near me now", Same Vibe,
PDFs.
*Check:* a shelf of 200 items answers "that Korean place someone mentioned" in
under a second, offline.

**Phase 4 — Growth.** Public shelves as the loop, import from mymind/Pocket/
Raindrop, API + webhooks.
*Check:* a published shelf opened by someone with no app converts to an install.

---

## 7. What would kill this, honestly

- **Instagram breaks the scrape.** The screenshot path exists precisely for
  this and must stay first-class.
- **Claude cost per save.** Every resolve is a model call. Needs a per-user
  budget and a cache before unlimited is sold.
- **Building alone.** Four of the last six weeks went on build quotas, keychain
  errors and CI, not features. A paid Expo plan is cheaper than the time.
- **mymind simply doing this.** They will not: resolution is not a feature they
  can bolt on, it is a different company.

---

## 8. What NOT to build

Folders. Teams. A feed. An AI chat over your shelf that nobody asked for.
Anything that makes the save slower than two taps.
