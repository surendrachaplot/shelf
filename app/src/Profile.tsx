// Profile.tsx — the library card.
//
// Not a settings screen with an avatar on top. It is the object people see
// when you hand them a shelf, so it is built as one: an ex-libris plate, a
// name, a line about yourself, the four shelves as a spread of colour, and the
// links you have handed out with how many times each was opened.
//
// EVERYTHING HERE IS ON THIS PHONE. There is no handle, because a handle was
// an address into a users table and there is no users table — nobody looks you
// up, you hand somebody a link. The name and the line about yourself travel
// only inside a snapshot you deliberately publish.
//
// Editing happens in place. A separate "edit profile" screen for three fields
// is a second screen that exists to hold a Save button.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { publishStats, revokePublish, shareUrl, pendingShareCount, sharedKeychainOk } from "./api";
import { countsOf, type Link, type Shelf } from "./store";
import { ExLibris } from "./ExLibris";
import { Press } from "./Press";
import { Reveal } from "./Reveal";
import { scrollKeyboardProps } from "./KeyboardSafe";
import { Screen } from "./Screen";
import {
  BOARD, labelOf, lists, listOn, LIST_ORDER, RULE, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./theme";

export function Profile({ shelf, onClose, onChange, onShare }: {
  shelf: Shelf;
  onClose: () => void;
  onChange: (next: Shelf) => void | Promise<unknown>;
  onShare: () => void;
}) {
  const { c } = useTheme();
  const s = styles(c);

  const [editing, setEditing] = useState(!shelf.profile.name);
  const [draft, setDraft] = useState(shelf.profile);
  const [views, setViews] = useState<Record<string, number>>({});
  // Two local facts, no network: can the share sheet see this phone's
  // Keychain, and is anything stuck in it. `sharedKeychainOk` existed from the
  // first day and was rendered nowhere, which is how "sharing silently does
  // nothing" stayed a mystery instead of being one tap to diagnose.
  const [wiring, setWiring] = useState<{ shared: boolean; queued: number } | null>(null);

  useEffect(() => {
    (async () => {
      setWiring({
        shared: await sharedKeychainOk().catch(() => false),
        queued: await pendingShareCount().catch(() => 0),
      });
    })();
  }, []);

  // View counts are the ONE thing here the phone cannot know: they are counted
  // where the page is served. Fails silently — a card is not a place to report
  // a network error.
  useEffect(() => {
    if (!shelf.links.length) return;
    publishStats(shelf.links.map((l) => l.code))
      .then((r) => setViews(r.views))
      .catch(() => {});
  }, [shelf.links]);

  const counts = countsOf(shelf);
  const total = Object.values(counts).reduce((n, x) => n + x, 0);
  const seed = shelf.profile.seed || shelf.profile.name || "shelf";

  async function save() {
    const name = draft.name.trim();
    await onChange({ ...shelf, profile: { ...draft, name, seed: shelf.profile.seed || name } });
    setEditing(false);
  }

  async function pull(code: string) {
    // Optimistic, then the real delete. Turning a link off has to feel
    // immediate — the reason you are tapping it is usually that you want it
    // gone NOW.
    await onChange({ ...shelf, links: shelf.links.filter((l) => l.code !== code) });
    await revokePublish(code).catch(() => {});
  }

  return (
    <Screen style={s.screen}>
      <View style={[s.head, s.inset]}>
        <Text style={s.wordmark}>Your card</Text>
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={s.micro}>Close</Text>
        </Press>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} {...scrollKeyboardProps}>
        <View style={s.rule} />

        <View style={[s.plateRow, s.inset]}>
          <ExLibris seed={seed} size={96} />
          <View style={s.who}>
            <Text style={s.kicker}>Ex libris</Text>
            <Text style={s.name} numberOfLines={2}>{shelf.profile.name || "Nobody yet"}</Text>
            <Text style={s.kickerFaint}>{total} shelved · on this phone</Text>
          </View>
        </View>

        {shelf.profile.bio && !editing ? <Text style={[s.bio, s.inset]}>{shelf.profile.bio}</Text> : null}

        {editing ? (
          <View style={[s.inset, s.editBlock]}>
            <Text style={s.body}>
              This is what somebody sees on a link you hand them. It stays on this
              phone until you share something.
            </Text>
            <Field label="Name" value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="Suren Chaplot" s={s} c={c} />
            <Field label="A line about you" value={draft.bio} onChange={(v) => setDraft((d) => ({ ...d, bio: v }))} placeholder="Mostly things I saw at 1am" s={s} c={c} multiline />
            {/* Not vanity: the city disambiguates a restaurant search, and
                "Ganapati" exists in several. */}
            <Field label="Where you are" value={draft.home_city} onChange={(v) => setDraft((d) => ({ ...d, home_city: v }))} placeholder="London" s={s} c={c} />
            <View style={s.actions}>
              <Press onPress={save} style={s.btn} size={TOUCH_MIN} label="Save your card">
                <Text style={s.btnLabel}>Save →</Text>
              </Press>
              {shelf.profile.name ? (
                <Press onPress={() => { setDraft(shelf.profile); setEditing(false); }} style={s.btnGhost} size={TOUCH_MIN} label="Cancel">
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
            <Press onPress={onShare} disabled={!total} style={s.btn} size={TOUCH_MIN} label="Share your shelves">
              <Text style={s.btnLabel}>Share your shelves →</Text>
            </Press>
          </View>
        )}

        {/* The four shelves as a spread of colour, standing on a board — the
            same language as the app itself. 2x2, not 1x4: in a single row the
            cells are 78pt wide and "RESTAURANTS" truncates. */}
        {[LIST_ORDER.slice(0, 2), LIST_ORDER.slice(2)].map((row, r) => (
          <View key={r}>
            <View style={[s.spread, s.inset]}>
              {row.map((l) => (
                <View key={l} style={[s.spreadCell, { backgroundColor: c[l] }]}>
                  <Text style={[s.spreadNum, { color: listOn[l] }]}>{String(counts[l] ?? 0).padStart(2, "0")}</Text>
                  <Text style={[s.spreadLabel, { color: listOn[l] }]} numberOfLines={1}>{lists[l].label}</Text>
                </View>
              ))}
            </View>
            <View style={s.board} />
          </View>
        ))}

        <View style={[s.inset, s.linksWrap]}>
          <Text style={s.h2}>Links you have handed out</Text>
          {shelf.links.length === 0 ? (
            <Text style={s.body}>
              None yet. Nothing of yours is on the internet until you share it — and
              when you do, only that one thing goes up. It shows up here with how many
              times it has been opened, and a way to pull it back.
            </Text>
          ) : shelf.links.map((sh: Link, i) => (
            <Reveal key={sh.code} index={i}>
              <View style={s.linkRow}>
                <View style={[s.linkSwatch, { backgroundColor: (sh.target ? (c as Record<string, string>)[sh.target] : null) ?? c.ink }]} />
                <View style={s.linkMain}>
                  <Text style={s.linkTitle} numberOfLines={1}>{sh.title}</Text>
                  <Text style={s.linkUrl} numberOfLines={1}>{shareUrl(sh.code)}</Text>
                </View>
                {/* "Opened 0 times" and "we have not counted" are different
                    facts, and a link nobody has opened says so in words. */}
                <Text style={s.linkViews}>
                  {views[sh.code] === undefined ? "—" : views[sh.code] === 0 ? "unopened" : `${views[sh.code]}×`}
                </Text>
                <Press onPress={() => pull(sh.code)} style={s.linkBtn} size={TOUCH_MIN} label="Turn this link off">
                  <Text style={s.micro}>Off</Text>
                </Press>
              </View>
            </Reveal>
          ))}
        </View>

        <View style={[s.inset, s.linksWrap]}>
          <Text style={s.h2}>Where your things live</Text>
          <Text style={s.body}>
            On this phone, in one file. Nothing is uploaded and there is no account —
            which also means shelf cannot get it back for you if you delete the app.
          </Text>
          {wiring === null ? (
            <Text style={s.body}>Checking…</Text>
          ) : (
            <>
              {/* THE SAME PROBE, A DIFFERENT CLAIM. On iOS this proves two
                  PROCESSES can see one Keychain group — the thing that
                  silently breaks and takes a week to find. Android has no
                  second process: the share opens the app itself, so the same
                  probe only proves this app can write its own queue. Saying
                  "the share sheet can reach this app" there would be a
                  sentence that is true for a reason nobody tested. */}
              <Fact
                ok={wiring.shared}
                good={Platform.OS === "android"
                  ? "Shared links open straight into shelf, and it can save them."
                  : "The share sheet can hand things to this app."}
                bad={Platform.OS === "android"
                  ? "This phone refused a test write, so a shared reel would not be saved."
                  : "The share sheet cannot reach this app. Sharing from Instagram will not work — install the latest build."}
                s={s} c={c}
              />
              <Fact
                ok={wiring.queued === 0}
                good="Nothing waiting to be read."
                bad={`${wiring.queued} share${wiring.queued === 1 ? "" : "s"} waiting. Pull down on the shelves to read them.`}
                s={s} c={c}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * A fact about the plumbing. The swatch carries the state and the sentence
 * carries the meaning — never a bare tick, which says a thing passed without
 * saying what the thing was.
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

function Field({ label, value, onChange, placeholder, multiline, s, c }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
  multiline?: boolean; s: ReturnType<typeof styles>; c: Palette;
}) {
  return (
    <View style={s.field}>
      <Text style={s.kickerFaint}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.inkFaint}
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

  head: { flexDirection: "row", alignItems: "baseline", paddingTop: sp.xl, paddingBottom: sp.md, paddingHorizontal: sp.lg },
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

  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.lg },
  btn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnGhost: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnLabel: { ...t.micro, color: c.bg },
  micro: { ...t.micro, color: c.ink },
  body: { ...t.meta, color: c.inkSoft, marginTop: sp.sm },
  h2: { ...t.section, color: c.ink },

  spread: { flexDirection: "row", gap: 2, marginTop: sp.xxl },
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
  factSwatch: { width: 9, height: 9, marginTop: 5 },
  factText: { ...t.meta, color: c.inkSoft, flex: 1 },
});
