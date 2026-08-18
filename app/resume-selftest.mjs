// resume-selftest.mjs — the decision that un-sticks "Working it out…".
//
// The bug it guards was reported from a phone and could not have been found
// any other way this project has: it needs an app to be suspended mid-resolve,
// which no screenshot, design gate or type check will ever stage. What CAN be
// asserted is the rule — a pending row seen at launch was interrupted, and is
// either picked up again or given a reason. Both, never neither.
import { resumePlan, whyStopped } from "./src/resume.js";

let fail = 0;
const ok = (c, label, got) => { if (!c) { fail++; console.error("FAIL", label, got === undefined ? "" : `\n      got: ${JSON.stringify(got)}`); } };

const link = (id, url = "https://www.instagram.com/reel/" + id) =>
  ({ id, status: "pending", source_url: url, title: null });
const shot = (id) => ({ id, status: "pending", source_url: null, title: null });
const done = (id) => ({ id, status: "filed", source_url: "https://x/" + id, title: "A thing" });
const unread = (id) => ({ id, status: "unread", source_url: "https://x/" + id, title: null });

// ── the rule: nothing pending is left alone ─────────────────────────────────
const mixed = [link("a"), shot("b"), done("c"), unread("d"), link("e")];
const plan = resumePlan(mixed);
ok(plan.pending.length === 3, "only pending rows are touched", plan.pending.map((i) => i.id));
ok(plan.retry.length + plan.giveUp.length === plan.pending.length,
   "EVERY pending row is either retried or explained — 'neither' is the bug", plan);
ok(plan.retry.map((i) => i.id).join() === "a,e", "a shared link can be read again", plan.retry.map((i) => i.id));
ok(plan.giveUp.map((i) => i.id).join() === "b", "a screenshot cannot — its file is gone with the container", plan.giveUp.map((i) => i.id));

// A filed or unread row is somebody's data and none of this business.
for (const it of [done("c"), unread("d")]) {
  ok(resumePlan([it]).pending.length === 0, `${it.status} is left alone`);
}

// ── the bound ───────────────────────────────────────────────────────────────
// A launch is not the place to make thirty network calls. What is dropped is
// not silently dropped: it lands in giveUp, which puts a reason and a button
// on the row.
const many = Array.from({ length: 20 }, (_, i) => link("i" + i));
const bounded = resumePlan(many, { max: 6 });
ok(bounded.retry.length === 6, "the retry burst is bounded", bounded.retry.length);
ok(bounded.giveUp.length === 14, "…and the rest are EXPLAINED, not forgotten", bounded.giveUp.length);
ok(bounded.retry.length + bounded.giveUp.length === 20, "still nothing left in limbo");

// ── rubbish in ──────────────────────────────────────────────────────────────
ok(resumePlan(null).pending.length === 0, "no shelf, no crash");
ok(resumePlan([null, undefined, {}]).pending.length === 0, "junk rows do not crash the plan");
ok(resumePlan([{ status: "pending", source_url: "not a url" }]).retry.length === 0,
   "a source_url that is not a link cannot be fetched, so it is not offered as a retry");
ok(resumePlan([{ status: "pending", source_url: "file:///var/tmp/x.jpg" }]).giveUp.length === 1,
   "a file path is a screenshot, not a link");

// ── what it says ────────────────────────────────────────────────────────────
// A reason that does not say what to do next is decoration.
const linkWhy = whyStopped(link("a"));
const shotWhy = whyStopped(shot("b"));
ok(/interrupted/i.test(linkWhy) && /read again/i.test(linkWhy), "a link says what happened and what to do", linkWhy);
ok(/interrupted/i.test(shotWhy) && /photos/i.test(shotWhy), "a screenshot points at the only route back", shotWhy);
ok(!/read again/i.test(shotWhy), "…and must NOT offer a retry that cannot work", shotWhy);

console.log(fail ? `resume selftest FAILED (${fail})` : "resume selftest ok");
process.exit(fail ? 1 : 0);
