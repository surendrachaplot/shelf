// Profile.tsx — the library card.
//
// This is not a settings screen with an avatar at the top. It is the object
// people see when you send them a shelf, so it is built as one: an ex-libris
// plate, a name, a line about yourself, the four shelves as a spread of
// colour, and — the part settings screens never have — the list of links you
// have handed out, with how many times each was opened and a way to pull any
// of them back.
//
// Editing happens in place. A separate "edit profile" screen for four fields
// is a second screen that exists to hold a Save button.
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  getProfile, listShares, pendingShareCount, revokeShare, saveProfile, shareUrl,
  type ProfileState, type Share,
} from "./api";
import { verifySharedAccess } from "./tokenStore";
import { handleProblem, normHandle } from "./exlibris.js";
import { ExLibris } from "./ExLibris";
import { Press } from "./Press";
import { Reveal } from "./Reveal";
import { scrollKeyboardProps } from "./KeyboardSafe";
import { Screen } from "./Screen";
import {
  BOARD, labelOf, lists, listOn, LIST_ORDER, RULE, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./theme";

export function Profile({ onClose, onShare }: {
  onClose: () => void;
  onShare: (handle: string) => void;
}) {
  const { c } = useTheme();
  const s = styles(c);

  const [state, setState] = useState<ProfileState | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ handle: "", display_name: "", bio: "" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await getProfile();
      setState(p);
      setDraft({
        handle: p.profile?.handle ?? "",
        display_name: p.profile?.display_name ?? "",
        bio: p.profile?.bio ?? "",
      });
      // A profile with no handle has no links yet by definition, and asking
      // for them would be a wasted round trip on the one screen where the
      // first-run experience matters most.
      setShares(p.needs_handle ? [] : await listShares().catch(() => []));
      setEditing(p.needs_handle);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Two local facts, no network. `verifySharedAccess` has existed since the
  // first day and was shown nowhere — which is how "sharing silently does
  // nothing" stayed a mystery instead of being one tap to diagnose.
  const [wiring, setWiring] = useState<{ shared: boolean; queued: number } | null>(null);
  useEffect(() => {
    (async () => {
      const [shared, queued] = await Promise.all([
        verifySharedAccess().catch(() => false),
        pendingShareCount().catch(() => 0),
      ]);
      setWiring({ shared, queued });
    })();
  }, []);

  async function save() {
    const problem = handleProblem(draft.handle);
    if (problem) { setSaveError(problem); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const next = await saveProfile({
        handle: normHandle(draft.handle),
        display_name: draft.display_name.trim() || null as never,
        bio: draft.bio.trim() || null as never,
      });
      setState(next);
      setEditing(false);
      setShares(await listShares().catch(() => []));
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function pull(code: string) {
    setShares((prev) => prev.filter((x) => x.code !== code));   // optimistic
    await revokeShare(code).catch(() => load());
  }

  if (loadError) {
    return (
      <Screen style={s.screen}>
        <Header onClose={onClose} s={s} title="Your card" />
        <View style={s.inset}>
          <Text style={s.h2}>Couldn't reach your card</Text>
          <Text style={s.body}>{loadError}. Nothing has been lost.</Text>
          <Press onPress={load} style={s.retry} size={TOUCH_MIN} label="Try again">
            <Text style={s.micro}>Try again →</Text>
          </Press>
        </View>
      </Screen>
    );
  }
  if (!state) {
    return (
      <Screen style={s.screen}>
        <Header onClose={onClose} s={s} title="Your card" />
        <ActivityIndicator color={c.inkFaint} style={s.spin} />
      </Screen>
    );
  }

  const seed = state.profile?.plate_seed || state.profile?.handle || draft.handle || "shelf";
  const total = Object.values(state.counts).reduce((n, x) => n + x, 0);

  return (
    <Screen style={s.screen}>
      <Header onClose={onClose} s={s} title="Your card" />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} {...scrollKeyboardProps}>
        <View style={s.rule} />

        <View style={[s.plateRow, s.inset]}>
          <ExLibris seed={seed} size={96} />
          <View style={s.who}>
            <Text style={s.kicker}>Ex libris</Text>
            <Text style={s.name} numberOfLines={2}>
              {state.profile?.display_name || (state.needs_handle ? "Nobody yet" : draft.handle)}
            </Text>
            <Text style={s.kickerFaint}>
              {state.profile?.handle ? `@${state.profile.handle}` : "no handle yet"}
              {state.profile?.since ? ` · since ${new Date(state.profile.since).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : ""}
            </Text>
          </View>
        </View>

        {state.profile?.bio && !editing ? <Text style={[s.bio, s.inset]}>{state.profile.bio}</Text> : null}

        {editing ? (
          <View style={[s.inset, s.editBlock]}>
            {state.needs_handle ? (
              <Text style={s.body}>
                Pick a handle. It is your address — the link people open, and the mark
                on your plate is drawn from it.
              </Text>
            ) : null}
            <Field label="Handle" value={draft.handle} onChange={(v) => setDraft((d) => ({ ...d, handle: v }))} placeholder="suren" s={s} c={c} autoCapitalize="none" />
            <Field label="Name" value={draft.display_name} onChange={(v) => setDraft((d) => ({ ...d, display_name: v }))} placeholder="Suren Chaplot" s={s} c={c} />
            <Field label="A line about you" value={draft.bio} onChange={(v) => setDraft((d) => ({ ...d, bio: v }))} placeholder="Mostly things I saw at 1am" s={s} c={c} multiline />
            {saveError ? <Text style={s.error}>{saveError}</Text> : null}
            <View style={s.actions}>
              <Press onPress={save} disabled={saving} style={s.btn} size={TOUCH_MIN} label="Save your card">
                {saving ? <ActivityIndicator color={c.bg} /> : <Text style={s.btnLabel}>Save →</Text>}
              </Press>
              {!state.needs_handle ? (
                <Press onPress={() => setEditing(false)} style={s.btnGhost} size={TOUCH_MIN} label="Cancel">
                  <Text style={s.micro}>Cancel</Text>
                </Press>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[s.inset, s.actions]}>
            <Press onPress={() => setEditing(true)} style={s.btnGhost} size={TOUCH_MIN} label="Edit your card">
              <Text style={s.micro}>Edit</Text>
            </Press>
            <Press
              onPress={() => state.profile?.handle && onShare(state.profile.handle)}
              disabled={!state.profile?.handle}
              style={s.btn} size={TOUCH_MIN} label="Share your shelves"
            >
              <Text style={s.btnLabel}>Share your shelves →</Text>
            </Press>
          </View>
        )}

        {/* The four shelves as a spread of colour, standing on a board. Same
            language as the app itself: a count is a thing that stands on
            something, not a number in a table. */}
        <View style={[s.inset, s.spreadWrap]}>
          <Text style={s.kickerFaint}>{total} shelved</Text>
        </View>
        {/* 2x2, not 1x4. In a single row of four the cells are 78pt wide and
            "RESTAURANTS" truncates to "RESTAUR…" — and a label you cannot read
            is not a label. Each row stands on its own board. */}
        {[LIST_ORDER.slice(0, 2), LIST_ORDER.slice(2)].map((row, r) => (
          <View key={r}>
            <View style={[s.spread, s.inset]}>
              {row.map((l) => (
                <View key={l} style={[s.spreadCell, { backgroundColor: c[l] }]}>
                  <Text style={[s.spreadNum, { color: listOn[l] }]}>{String(state.counts[l] ?? 0).padStart(2, "0")}</Text>
                  <Text style={[s.spreadLabel, { color: listOn[l] }]} numberOfLines={1}>{lists[l].label}</Text>
                </View>
              ))}
            </View>
            <View style={s.board} />
          </View>
        ))}

        <View style={[s.inset, s.linksWrap]}>
          <Text style={s.h2}>Links you have handed out</Text>
          {shares.length === 0 ? (
            <Text style={s.body}>
              None yet. Share a shelf or a single thing and the link shows up here —
              with how many times it has been opened, and a way to pull it back.
            </Text>
          ) : shares.map((sh, i) => (
            <Reveal key={sh.code} index={i}>
              <View style={s.linkRow}>
                <View style={[s.linkSwatch, { backgroundColor: (sh.kind === "shelf" && sh.target ? (c as Record<string, string>)[sh.target] : null) ?? c.ink }]} />
                <View style={s.linkMain}>
                  <Text style={s.linkTitle} numberOfLines={1}>
                    {sh.kind === "profile" ? "Your whole card" : sh.kind === "shelf" ? `${labelOf(sh.target)} shelf` : "One thing"}
                  </Text>
                  <Text style={s.linkUrl} numberOfLines={1}>{shareUrl(sh.code)}</Text>
                </View>
                {/* "Opened 0 times" and "we have not counted" are different
                    facts; a link that nobody has opened says so in words. */}
                <Text style={s.linkViews}>{sh.views === 0 ? "unopened" : `${sh.views}×`}</Text>
                <Press onPress={() => pull(sh.code)} style={s.linkBtn} size={TOUCH_MIN} label="Turn this link off">
                  <Text style={s.micro}>Off</Text>
                </Press>
              </View>
            </Reveal>
          ))}
        </View>

        {/* The answer to "I shared a reel and nothing happened". Three facts,
            in the order they can fail, each saying what to do about it. */}
        <View style={[s.inset, s.linksWrap]}>
          <Text style={s.h2}>Sharing from Instagram</Text>
          {wiring === null ? (
            <Text style={s.body}>Checking…</Text>
          ) : (
            <>
              <Fact
                ok={wiring.shared}
                good="The share sheet can read this phone's key."
                bad="The share sheet cannot read this phone's key. Shares from Instagram will not save — install the latest build and pair again."
                s={s} c={c}
              />
              <Fact
                ok={wiring.queued === 0}
                good="Nothing stranded — every share made it up."
                bad={`${wiring.queued} share${wiring.queued === 1 ? "" : "s"} saved with no signal. They go up next time you open shelf with the server reachable.`}
                s={s} c={c}
              />
            </>
          )}
          <Text style={s.body}>
            A reel takes a few seconds to read after you share it. Until then it is on
            the fifth tab — Not shelved — with whatever we have so far. Anything we
            could not read stays there rather than being filed wrongly.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Header({ onClose, title, s }: { onClose: () => void; title: string; s: ReturnType<typeof styles> }) {
  return (
    <View style={[s.head, s.inset]}>
      <Text style={s.wordmark}>{title}</Text>
      <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
        <Text style={s.micro}>Close</Text>
      </Press>
    </View>
  );
}

/**
 * A fact about the plumbing. The swatch carries the state and the sentence
 * carries the meaning — never a bare tick, which tells you a thing passed
 * without telling you what the thing was.
 */
function Fact({ ok, good, bad, s, c }: {
  ok: boolean; good: string; bad: string;
  s: ReturnType<typeof styles>; c: Palette;
}) {
  return (
    <View style={s.factRow}>
      <View style={[s.factSwatch, { backgroundColor: ok ? c.good : c.accent }]} />
      <Text style={[s.factText, ok ? null : { color: c.ink }]}>{ok ? good : bad}</Text>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, multiline, autoCapitalize, s, c }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  multiline?: boolean; autoCapitalize?: "none" | "sentences";
  s: ReturnType<typeof styles>; c: Palette;
}) {
  return (
    <View style={s.field}>
      <Text style={s.kickerFaint}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.inkFaint}
        autoCapitalize={autoCapitalize ?? "sentences"}
        autoCorrect={!multiline ? false : undefined}
        multiline={multiline}
        maxLength={multiline ? 200 : 60}
        style={[s.input, multiline ? s.inputTall : null]}
      />
    </View>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { paddingBottom: sp.huge },
  inset: { paddingHorizontal: sp.lg },

  head: { flexDirection: "row", alignItems: "baseline", paddingTop: sp.xl, paddingBottom: sp.md },
  wordmark: { ...t.wordmark, color: c.ink, flex: 1 },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  rule: { height: RULE, backgroundColor: c.ink },

  plateRow: { flexDirection: "row", gap: sp.lg, alignItems: "flex-start", paddingTop: sp.lg },
  who: { flex: 1, minWidth: 0 },
  kicker: { ...t.micro, color: c.ink },
  kickerFaint: { ...t.micro, color: c.inkFaint, marginTop: sp.xs },
  name: { ...t.itemTitle, color: c.ink, marginTop: sp.xs },
  bio: { ...t.body, color: c.inkSoft, marginTop: sp.md },

  editBlock: { marginTop: sp.lg, gap: sp.sm },
  field: { marginTop: sp.sm },
  input: {
    ...t.bodyMed, color: c.ink, minHeight: TOUCH_MIN, paddingHorizontal: sp.md,
    borderWidth: 2, borderColor: c.ink, marginTop: sp.xs, backgroundColor: c.bg,
  },
  inputTall: { minHeight: TOUCH_MIN + 24, paddingTop: sp.sm, textAlignVertical: "top" },
  error: { ...t.meta, color: c.accent, marginTop: sp.sm },

  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.lg },
  btn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnGhost: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnLabel: { ...t.micro, color: c.bg },
  micro: { ...t.micro, color: c.ink },
  body: { ...t.meta, color: c.inkSoft, marginTop: sp.sm },
  h2: { ...t.section, color: c.ink },
  retry: { marginTop: sp.md, minHeight: TOUCH_MIN, justifyContent: "center", alignSelf: "flex-start" },
  spin: { marginTop: sp.huge },

  spreadWrap: { marginTop: sp.xxl },
  spread: { flexDirection: "row", gap: 2, marginTop: sp.md },
  spreadCell: { flex: 1, paddingVertical: sp.md, paddingHorizontal: sp.sm, minHeight: 72, justifyContent: "flex-end" },
  spreadNum: { ...t.itemTitle },
  spreadLabel: { ...t.tag, marginTop: sp.xs },
  // Full bleed, exactly like the bookcase. A board that stops at the inset is
  // a card, and this is the same object the shelves are made of.
  board: { height: BOARD, backgroundColor: c.ink },

  linksWrap: { marginTop: sp.xxl },
  linkRow: {
    flexDirection: "row", alignItems: "center", gap: sp.sm, borderWidth: 2,
    borderColor: c.ink, paddingLeft: sp.md, marginTop: sp.sm, minHeight: TOUCH_MIN + 12,
  },
  linkSwatch: { width: 9, height: 9 },
  linkMain: { flex: 1, minWidth: 0, paddingVertical: sp.sm },
  linkTitle: { ...t.bodyMed, color: c.ink },
  linkUrl: { ...t.meta, color: c.inkFaint },
  linkViews: { ...t.micro, color: c.inkFaint },
  linkBtn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.md, justifyContent: "center" },

  factRow: { flexDirection: "row", gap: sp.sm, marginTop: sp.md, alignItems: "flex-start" },
  // Aligned to the cap-height of the first line rather than the box, so the
  // square sits ON the sentence instead of above it.
  factSwatch: { width: 9, height: 9, marginTop: 5 },
  factText: { ...t.meta, color: c.inkSoft, flex: 1 },
});
