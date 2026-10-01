// ListsScreen.tsx — your own lists: an outfit, a trip, gifts for somebody.
//
// The six shelves are what a thing IS. A list is what it is FOR, and one thing
// can be for several. A wishlist is a list whose things have prices; a
// moodboard is a list looked at as pictures. They are the same object with two
// views, which is why this is one screen and not three features.
//
// Paper: file "shelf" → "Boards" (the index; the word on screen is Lists),
// "List open — moodboard (pictures)", "List open — rows with prices and a
// total", "Add to a list — from an item".
//
// The logic is lists.js, which is tested line by line. This file only draws.
// One component, three states — the index, one list open, and "add this item
// to a list" — because each is the one before with something picked.
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { idFor, upsert, type Board, type Item, type Shelf } from "./store";
import {
  itemsOf, listsWith, makeList, pin, priceOf, priceText, removeList, setView, togglePin, totalOf,
} from "./lists.js";
import { keepPicture } from "./pictures";
import { imagePicker } from "./native";
import { Press } from "./Press";
import { Reveal } from "./Reveal";
import { KeyboardSafe, scrollKeyboardProps } from "./KeyboardSafe";
import {
  BOARD, COVER_KEYLINE, labelOf, listOn, numberOf, numeric, RULE, sp, t, TOUCH_MIN, useTheme, type Palette,
} from "./theme";

// EVERYTHING is a list nobody made: all of it, as pictures. It is not stored —
// a row in the file that says "all items" would be a second source of truth
// for something the items array already is.
const EVERYTHING = "*";
const everything = (view: Board["view"]): Board =>
  ({ id: EVERYTHING, name: "Everything", pins: [], query: null, view, created_at: "" });

const two = (n: number) => String(n).padStart(2, "0");
const kindOf = (item: Item) => (item.canonical as { kind?: string } | null)?.kind ?? null;

/** What an item costs, as it should be shown, or null. */
// ONE formatter for a row and for the total under it. The server's own text
// says "£65.00" and the total says "£83"; side by side that reads as two
// different apps. The server's text is kept only for what a single number
// cannot say — a range ("$20 to $35") — or when there is no currency to
// format with.
const priceOn = (item: Item): string | null => {
  const said = (item.canonical as { price_text?: string } | null)?.price_text ?? null;
  if (said && / to /.test(said)) return said;
  const p = priceOf(item);
  return p ? priceText(p.amount, p.currency) : said;
};
// "No price" is a fact about a THING TO BUY. A book or a note on the same list
// is not missing a price, so it is not counted as one that is.
const unpricedOf = (items: Item[]) => items.filter((i) => kindOf(i) === "product" && !priceOn(i)).length;

// A tile's height comes from its id, so a board keeps its shape between
// launches instead of reshuffling. Four steps on the 4pt grid.
const HEIGHTS = [152, 184, 212, 240];
const heightOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HEIGHTS[h % HEIGHTS.length];
};

/** Two columns, each new tile on the shorter one. */
function columns(items: Item[]): [Item[], Item[]] {
  const cols: [Item[], Item[]] = [[], []];
  const tall = [0, 0];
  for (const it of items) {
    const c = tall[0] <= tall[1] ? 0 : 1;
    cols[c].push(it);
    tall[c] += heightOf(it.id);
  }
  return cols;
}

export function Lists({ shelf, start = null, adding = null, onChange, onClose, onOpen }: {
  shelf: Shelf;
  /** Open straight on one list. */
  start?: string | null;
  /** "Add THIS to a list" — the third state. */
  adding?: Item | null;
  onChange: (next: Shelf) => void | Promise<unknown>;
  onClose: () => void;
  onOpen: (item: Item) => void;
}) {
  const { c } = useTheme();
  const s = useMemo(() => styles(c), [c]);
  const [open, setOpen] = useState<string | null>(start);
  const [allView, setAllView] = useState<Board["view"]>("pictures");
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);   // null = not writing
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);

  const boards = shelf.boards ?? [];
  const filed = useMemo(() => shelf.items.filter((i) => i.status === "filed"), [shelf.items]);
  const list = open === EVERYTHING ? everything(allView) : boards.find((b) => b.id === open) ?? null;
  const members = useMemo(
    () => (list ? (list.id === EVERYTHING ? filed : itemsOf(list, shelf.items)) : []),
    [list, filed, shelf.items]
  );
  const total = useMemo(() => (list ? totalOf({ ...list, pins: members.map((m) => m.id), query: null }, members) : null), [list, members]);

  const save = (next: Board[]) => (next === boards ? undefined : onChange({ ...shelf, boards: next }));

  function make(thenPin?: Item) {
    const b = makeList(name, { now: new Date() });
    if (!b) return;
    const next = [b, ...boards];
    save(thenPin ? pin(next, b.id, thenPin.id) : next);
    setName("");
    if (!thenPin) setOpen(b.id);
  }

  /** A note is an item whose words are the whole of it. */
  async function saveNote() {
    const text = (note ?? "").trim();
    if (!text) { setNote(null); return; }
    const now = new Date().toISOString();
    const item: Item = {
      id: idFor(`note:${now}`), list: "unsorted", status: "filed",
      title: text.split("\n")[0].slice(0, 80), subtitle: "", note: text,
      image_url: null, canonical: { kind: "note" }, confidence: null, enriched: false,
      source_url: null, resolver: "note", created_at: now, resolved_at: now,
    };
    const withItem = upsert(shelf, item);
    await onChange(list && list.id !== EVERYTHING ? { ...withItem, boards: pin(boards, list.id, item.id) } : withItem);
    setNote(null);
  }

  /** Pictures from the camera roll, kept, and pinned to the open list. */
  async function addPictures() {
    const P = imagePicker();
    if (!P || !list) { setSaid("This build cannot pick pictures. A newer build can."); return; }
    setSaid(null);
    const got = await P.launchImageLibraryAsync({ mediaTypes: P.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 12 });
    if (got.canceled) return;
    setBusy(true);
    try {
      let next = shelf;
      let pins = boards;
      for (const [i, a] of got.assets.entries()) {
        const now = new Date().toISOString();
        const id = idFor(`picture:${now}:${i}`);
        const kept = await keepPicture(a.uri, id).catch(() => null);
        if (!kept) { setSaid("One picture could not be kept."); continue; }
        next = upsert(next, {
          id, list: "unsorted", status: "filed", title: "Picture", subtitle: "", note: "",
          image_url: kept, canonical: { kind: "picture" }, confidence: null, enriched: false,
          source_url: null, resolver: "picture", created_at: now, resolved_at: now,
        });
        if (list.id !== EVERYTHING) pins = pin(pins, list.id, id);
      }
      await onChange({ ...next, boards: pins });
    } finally {
      setBusy(false);
    }
  }

  // ── "Add this to a list" ───────────────────────────────────────────────────
  if (adding) {
    const on = new Set(listsWith(boards, adding.id).map((b) => b.id));
    return (
      <KeyboardSafe style={s.screen}>
        <View style={[s.head, s.inset]}>
          <View style={s.headText}>
            <Text style={s.kind} numberOfLines={1}>{adding.title ?? "This one"}</Text>
            <Text style={s.title}>Add to a list</Text>
          </View>
          <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Done">
            <Text style={s.micro}>Done</Text>
          </Press>
        </View>
        <View style={s.rule} />
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} {...scrollKeyboardProps}>
          <View style={s.inset}>
            {boards.map((b) => (
              <Press key={b.id} onPress={() => save(togglePin(boards, b.id, adding.id))} size={TOUCH_MIN + 12}
                     style={[s.pick, on.has(b.id) ? s.pickOn : null]}
                     label={on.has(b.id) ? `Take off ${b.name}` : `Add to ${b.name}`}>
                <Text style={[s.pickName, on.has(b.id) ? { color: c.bg } : null]} numberOfLines={1}>{b.name}</Text>
                <Text style={[s.micro, { color: on.has(b.id) ? c.bg : c.inkSoft }]}>{on.has(b.id) ? "On it" : "Add"}</Text>
              </Press>
            ))}
            <Text style={[s.kind, s.newLabel]}>New list</Text>
            <View style={s.newRow}>
              <TextInput value={name} onChangeText={setName} placeholder="A name for it" placeholderTextColor={c.inkFaint}
                         maxLength={60} style={s.input} returnKeyType="done" onSubmitEditing={() => make(adding)} />
              <Press onPress={() => make(adding)} disabled={!name.trim()} style={s.btn} size={TOUCH_MIN} label="Make the list and add it">
                <Text style={s.btnLabel}>Make →</Text>
              </Press>
            </View>
          </View>
        </ScrollView>
      </KeyboardSafe>
    );
  }

  // ── one list, open ─────────────────────────────────────────────────────────
  if (list) {
    const view = list.view;
    const flip = (v: Board["view"]) => (list.id === EVERYTHING ? setAllView(v) : save(setView(boards, list.id, v)));
    const [left, right] = columns(members);
    const money = total?.byCurrency.map((m) => m.text).join(" + ") ?? "";
    return (
      <KeyboardSafe style={s.screen}>
        <View style={[s.head, s.inset]}>
          <View style={s.headText}>
            <Text style={s.kind}>List</Text>
            <Text style={s.title} numberOfLines={2}>{list.name}</Text>
          </View>
          <Press onPress={() => setOpen(null)} style={s.close} size={TOUCH_MIN} label="All lists">
            <Text style={s.micro}>All lists</Text>
          </Press>
          <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
            <Text style={s.micro}>Close</Text>
          </Press>
        </View>
        <View style={s.rule} />

        <View style={[s.viewRow, s.inset]}>
          <View style={s.switch}>
            {(["pictures", "rows"] as const).map((v) => (
              <Press key={v} onPress={() => flip(v)} size={TOUCH_MIN} label={`Show as ${v}`}
                     style={[s.switchTab, view === v ? s.switchOn : null]}>
                <Text style={[s.micro, view === v ? { color: c.bg } : null]}>{v}</Text>
              </Press>
            ))}
          </View>
          <Text style={s.count} numberOfLines={1}>
            {two(members.length)} {members.length === 1 ? "thing" : "things"}{view === "pictures" && money ? ` · ${money}` : ""}
          </Text>
        </View>

        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} {...scrollKeyboardProps}>
          {members.length === 0 ? (
            // §Empty states: a title, what happens next, a way forward (below).
            <View style={s.inset}>
              <Text style={s.emptyTitle}>Nothing on this list yet</Text>
              <Text style={s.emptyBody}>
                Open anything you have saved and tap Add to a list. Or add pictures and notes here.
              </Text>
            </View>
          ) : view === "pictures" ? (
            <View style={[s.grid, s.inset]}>
              {[left, right].map((col, ci) => (
                <View key={ci} style={s.col}>
                  {col.map((item) => <Tile key={item.id} item={item} onOpen={() => onOpen(item)} s={s} c={c} />)}
                </View>
              ))}
            </View>
          ) : (
            <View style={s.inset}>
              {members.map((item, i) => {
                const fill = (c as Record<string, string>)[item.list] ?? c.unsorted;
                const on = (listOn as Record<string, string>)[item.list] ?? c.onList;
                return (
                  <Reveal key={item.id} index={i}>
                    <Press onPress={() => onOpen(item)} style={s.row} size={TOUCH_MIN + 20}
                           label={`${item.title ?? "Not read yet"}, ${labelOf(item.list)}`}>
                      <View style={[s.block, { backgroundColor: fill }]}>
                        <Text style={[s.blockNum, { color: on }]}>{numberOf(item.list)}</Text>
                      </View>
                      <View style={s.rowMain}>
                        <Text style={s.rowTitle} numberOfLines={2}>{item.title ?? "Not read yet"}</Text>
                        {item.subtitle ? <Text style={s.rowSub} numberOfLines={1}>{item.subtitle}</Text> : null}
                      </View>
                      {/* A FIXED slot, filled or not, so every price ends on
                          the same right-hand edge down the list. */}
                      <View style={s.priceSlot}>
                        {priceOn(item) ? <Text style={s.rowPrice} numberOfLines={1}>{priceOn(item)}</Text> : null}
                      </View>
                    </Press>
                  </Reveal>
                );
              })}
              {/* One line per currency. Pounds and dollars are never added
                  together — lists.js refuses to, and so does this. */}
              {total && total.priced > 0 ? (
                <View style={s.total}>
                  <View style={s.totalText}>
                    <Text style={s.micro}>Total</Text>
                    <Text style={s.totalNote}>
                      {total.priced} with a price.{unpricedOf(members) ? ` ${unpricedOf(members)} with no price.` : ""}
                    </Text>
                  </View>
                  <View>
                    {total.byCurrency.map((m) => <Text key={m.currency} style={s.totalAmount}>{m.text}</Text>)}
                  </View>
                </View>
              ) : null}
            </View>
          )}

          {note !== null ? (
            <View style={[s.inset, s.writer]}>
              <Text style={s.kind}>New note</Text>
              <TextInput value={note} onChangeText={setNote} autoFocus multiline maxLength={4000}
                         placeholder="Write it down" placeholderTextColor={c.inkFaint} style={s.noteInput} />
              <View style={s.actions}>
                <Press onPress={saveNote} style={s.btn} size={TOUCH_MIN} label="Save the note">
                  <Text style={s.btnLabel}>Save note →</Text>
                </Press>
                <Press onPress={() => setNote(null)} style={s.btnGhost} size={TOUCH_MIN} label="Cancel">
                  <Text style={s.micro}>Cancel</Text>
                </Press>
              </View>
            </View>
          ) : (
            <View style={[s.inset, s.actions, s.foot]}>
              <Press onPress={addPictures} disabled={busy} style={s.btn} size={TOUCH_MIN} label="Add pictures">
                {busy ? <ActivityIndicator color={c.bg} /> : <Text style={s.btnLabel}>Add pictures →</Text>}
              </Press>
              <Press onPress={() => setNote("")} style={s.btnGhost} size={TOUCH_MIN} label="Write a note">
                <Text style={s.micro}>Write a note</Text>
              </Press>
              {list.id !== EVERYTHING ? (
                <Press onPress={() => { save(removeList(boards, list.id)); setOpen(null); }} style={s.btnGhost} size={TOUCH_MIN}
                       label={`Delete the list ${list.name}`}>
                  <Text style={s.micro}>Delete list</Text>
                </Press>
              ) : null}
            </View>
          )}
          {said ? <Text style={[s.inset, s.said]}>{said}</Text> : null}
        </ScrollView>
      </KeyboardSafe>
    );
  }

  // ── the index ──────────────────────────────────────────────────────────────
  return (
    <KeyboardSafe style={s.screen}>
      <View style={[s.head, s.inset]}>
        <View style={s.headText}><Text style={s.title}>Lists</Text></View>
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={s.micro}>Close</Text>
        </Press>
      </View>
      <View style={s.rule} />
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false} {...scrollKeyboardProps}>
        <Text style={[s.intro, s.inset]}>
          A list is for anything: an outfit, a trip, gifts. Put saved things, pictures and notes on it.
        </Text>
        {[everything(allView), ...boards].map((b) => {
          const mine = b.id === EVERYTHING ? filed : itemsOf(b, shelf.items);
          const sum = totalOf({ ...b, pins: mine.map((m) => m.id), query: null }, mine).byCurrency.map((m) => m.text).join(" + ");
          // The shelf mix: how much of the list is which colour. One glance
          // says "mostly restaurants", which a count cannot.
          const mix = Object.entries(mine.reduce<Record<string, number>>((n, i) => ({ ...n, [i.list]: (n[i.list] ?? 0) + 1 }), {}))
            .sort((a, z) => z[1] - a[1]).slice(0, 5);
          return (
            <Press key={b.id} onPress={() => setOpen(b.id)} containerStyle={s.boardSlot} size={TOUCH_MIN + 40}
                   label={`${b.name}, ${mine.length} things`}>
              <View style={[s.boardFace, s.inset]}>
                <View style={s.boardText}>
                  <Text style={s.boardName} numberOfLines={2}>{b.name}</Text>
                  {sum || b.query ? (
                    <Text style={s.kind} numberOfLines={1}>{[b.query ? `Finds “${b.query}”` : null, sum].filter(Boolean).join(" · ")}</Text>
                  ) : null}
                  {mix.length ? (
                    <View style={s.mix}>
                      {mix.map(([l, n]) => (
                        <View key={l} style={[s.mixBar, { flexGrow: n, backgroundColor: (c as Record<string, string>)[l] ?? c.unsorted }]} />
                      ))}
                    </View>
                  ) : null}
                </View>
                <Text style={s.boardCount}>{two(mine.length)}</Text>
              </View>
              <View style={s.boardEdge} />
            </Press>
          );
        })}

        <View style={[s.inset, s.newBlock]}>
          <Text style={s.kind}>New list</Text>
          <View style={s.newRow}>
            <TextInput value={name} onChangeText={setName} placeholder="A name for it" placeholderTextColor={c.inkFaint}
                       maxLength={60} style={s.input} returnKeyType="done" onSubmitEditing={() => make()} />
            <Press onPress={() => make()} disabled={!name.trim()} style={s.btn} size={TOUCH_MIN} label="Make the list">
              <Text style={s.btnLabel}>Make →</Text>
            </Press>
          </View>
        </View>
      </ScrollView>
    </KeyboardSafe>
  );
}

/** One thing on a moodboard: its picture, or a jacket when it has none. */
function Tile({ item, onOpen, s, c }: { item: Item; onOpen: () => void; s: ReturnType<typeof styles>; c: Palette }) {
  const [failed, setFailed] = useState(false);
  const art = item.image_url && !failed ? item.image_url : null;
  const note = kindOf(item) === "note";
  const fill = note ? c.bg : (c as Record<string, string>)[item.list] ?? c.unsorted;
  const on = note ? c.ink : (listOn as Record<string, string>)[item.list] ?? c.onList;
  const price = priceOn(item);
  const h = note ? undefined : heightOf(item.id);
  return (
    <Press onPress={onOpen} size={TOUCH_MIN + 60} style={[s.tile, { backgroundColor: fill, height: h }]}
           label={`Open ${item.title ?? "it"}`}>
      {art ? (
        <Image source={{ uri: art }} style={s.tileArt} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <Text style={[note ? s.tileNote : s.tileTitle, { color: on }]} numberOfLines={note ? 8 : 4}>
          {note ? item.note || item.title : item.title ?? "Not read yet"}
        </Text>
      )}
      {price ? <View style={s.tag}><Text style={s.tagText}>{price}</Text></View> : null}
    </Press>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  inset: { paddingHorizontal: sp.lg },
  scroll: { paddingTop: sp.sm, paddingBottom: sp.huge },

  head: { flexDirection: "row", alignItems: "flex-end", gap: sp.lg, paddingTop: sp.xl, paddingBottom: sp.md },
  headText: { flex: 1, minWidth: 0 },
  kind: { ...t.micro, color: c.inkSoft },
  title: { ...t.detailTitle, color: c.ink },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  micro: { ...t.micro, color: c.ink },
  rule: { height: RULE, backgroundColor: c.ink },
  intro: { ...t.body, color: c.inkSoft, marginTop: sp.lg },

  boardSlot: { marginTop: sp.xl },
  boardFace: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: sp.md, paddingBottom: sp.md },
  boardText: { flex: 1, minWidth: 0, gap: sp.xs },
  boardName: { ...t.itemTitle, fontSize: t.band.fontSize - 6, lineHeight: t.band.fontSize, color: c.ink },
  boardCount: { ...t.detailTitle, ...numeric, color: c.ink },
  boardEdge: { height: BOARD, backgroundColor: c.ink },
  mix: { flexDirection: "row", gap: 2, height: sp.sm, width: "70%", marginTop: sp.xs },
  mixBar: { flexBasis: 0, height: sp.sm },

  newBlock: { marginTop: sp.xxl },
  newLabel: { marginTop: sp.xl },
  newRow: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.sm },
  input: {
    ...t.bodyMed, color: c.ink, flex: 1, minWidth: 160, minHeight: TOUCH_MIN + 8, paddingHorizontal: sp.md,
    borderWidth: 2, borderColor: c.ink, backgroundColor: c.bg,
  },
  btn: { minHeight: TOUCH_MIN + 8, paddingHorizontal: sp.lg, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnGhost: { minHeight: TOUCH_MIN + 8, paddingHorizontal: sp.lg, borderWidth: 2, borderColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnLabel: { ...t.micro, color: c.bg },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, marginTop: sp.md },
  foot: { marginTop: sp.xl },
  said: { ...t.meta, color: c.accent, marginTop: sp.md },

  pick: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: sp.md,
    minHeight: TOUCH_MIN + 12, paddingHorizontal: sp.md, borderWidth: 2, borderColor: c.ink, marginTop: sp.sm,
  },
  pickOn: { backgroundColor: c.ink },
  pickName: { ...t.bodyMed, fontWeight: "700", color: c.ink, flex: 1, minWidth: 0 },

  viewRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: sp.sm, paddingVertical: sp.md },
  switch: { flexDirection: "row" },
  switchTab: { minHeight: TOUCH_MIN, paddingHorizontal: sp.md, justifyContent: "center", borderWidth: 2, borderColor: c.ink },
  switchOn: { backgroundColor: c.ink },
  count: { ...t.micro, ...numeric, color: c.inkSoft },

  // Two columns that always fit: each takes 40% as its basis and grows, so
  // `wrap` is declared (§4) and never happens.
  grid: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm },
  col: { flexGrow: 1, flexShrink: 1, flexBasis: "40%", minWidth: 0, gap: sp.sm },
  tile: { borderWidth: COVER_KEYLINE, borderColor: c.ink, overflow: "hidden", justifyContent: "space-between", minHeight: TOUCH_MIN + 60 },
  tileArt: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  tileTitle: { ...t.bodyMed, fontWeight: "700", padding: sp.sm },
  tileNote: { ...t.body, padding: sp.sm },
  // The price sits on paper, not on the picture: a number over a photograph is
  // a contrast ratio nobody computed.
  tag: {
    alignSelf: "flex-start", marginTop: "auto", backgroundColor: c.bg, paddingHorizontal: sp.sm, paddingVertical: sp.xs,
    borderTopWidth: COVER_KEYLINE, borderRightWidth: COVER_KEYLINE, borderColor: c.ink,
  },
  tagText: { ...t.meta, ...numeric, fontWeight: "700", color: c.ink },

  row: {
    flexDirection: "row", alignItems: "stretch", borderWidth: 2, borderColor: c.ink,
    marginTop: sp.sm, minHeight: TOUCH_MIN + 20,
  },
  block: { width: TOUCH_MIN + 6, alignItems: "center", justifyContent: "center" },
  blockNum: { ...t.tag },
  rowMain: { flex: 1, minWidth: 0, padding: sp.md, justifyContent: "center" },
  rowTitle: { ...t.bodyMed, fontWeight: "700", color: c.ink },
  rowSub: { ...t.meta, color: c.inkSoft, marginTop: 2 },
  priceSlot: { width: 76, flexShrink: 0, alignItems: "flex-end", justifyContent: "center", paddingRight: sp.md },
  rowPrice: { ...t.bodyMed, ...numeric, fontWeight: "700", color: c.ink },

  total: {
    flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: sp.md,
    marginTop: sp.xl, paddingTop: sp.md, borderTopWidth: RULE, borderTopColor: c.ink,
  },
  totalText: { flex: 1, minWidth: 0, gap: sp.xs },
  totalNote: { ...t.meta, color: c.inkSoft },
  totalAmount: { ...t.detailTitle, ...numeric, color: c.ink, textAlign: "right" },

  writer: { marginTop: sp.xl },
  noteInput: {
    ...t.body, color: c.ink, minHeight: TOUCH_MIN * 3, marginTop: sp.sm, padding: sp.md,
    borderWidth: 2, borderColor: c.ink, textAlignVertical: "top",
  },

  emptyTitle: { ...t.section, color: c.ink, marginTop: sp.xl },
  emptyBody: { ...t.body, color: c.inkSoft, marginTop: sp.xs },
});
