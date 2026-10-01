// NoteWriter.tsx — a note, written down.
//
// Paper: file "shelf" → "Notes shelf — 08, and writing a note".
//
// A note is an ITEM. Not a second kind of thing with its own file and its own
// screen to find it on: it stands on the Notes shelf, Find reads it, a list
// can hold it, and Take a copy carries it out. The only thing that makes it a
// note is `canonical.kind`, and the only thing this screen does is make one.
//
// Full screen and nothing else on it. The field is the whole page, so there is
// nothing to scroll past and nothing under the keyboard (KeyboardSafe).
import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { idFor, type Item } from "./store";
import { Press } from "./Press";
import { KeyboardSafe } from "./KeyboardSafe";
import { RULE, sp, t, TOUCH_MIN, useTheme, type Palette } from "./theme";

// The title is the first line, cut to what a row can show. The whole text is
// kept in `note`, which is the field Find and the export already read.
const TITLE_MAX = 80;
const NOTE_MAX = 4000;

/** The item a note becomes. Pure, so the shape is in one place. */
export function noteItem(text: string, now: Date = new Date()): Item | null {
  const said = text.trim();
  if (!said) return null;
  const at = now.toISOString();
  return {
    id: idFor(`note:${at}`), list: "notes", status: "filed",
    title: said.split("\n")[0].trim().slice(0, TITLE_MAX), subtitle: "", note: said,
    image_url: null, canonical: { kind: "note" }, confidence: null, enriched: false,
    source_url: null, resolver: "note", created_at: at, resolved_at: at,
  };
}

export function NoteWriter({ onClose, onSave }: {
  onClose: () => void;
  onSave: (item: Item) => void | Promise<unknown>;
}) {
  const { c } = useTheme();
  const s = styles(c);
  const [text, setText] = useState("");
  const item = noteItem(text);

  return (
    <KeyboardSafe style={s.screen}>
      <View style={s.head}>
        <Text style={s.kicker}>New note</Text>
        <Press onPress={onClose} style={s.close} size={TOUCH_MIN} label="Close">
          <Text style={s.micro}>Close</Text>
        </Press>
      </View>
      <View style={s.rule} />
      <TextInput
        value={text}
        onChangeText={setText}
        autoFocus
        multiline
        maxLength={NOTE_MAX}
        placeholder="Write it down"
        placeholderTextColor={c.inkFaint}
        style={s.input}
      />
      <View style={s.actions}>
        <Press onPress={() => item && onSave(item)} disabled={!item} style={s.btn} size={TOUCH_MIN} label="Save the note">
          <Text style={s.btnLabel}>Save note →</Text>
        </Press>
      </View>
    </KeyboardSafe>
  );
}

const styles = (c: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: sp.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: sp.xl, paddingBottom: sp.sm },
  kicker: { ...t.micro, color: c.inkSoft },
  micro: { ...t.micro, color: c.ink },
  close: { minHeight: TOUCH_MIN, justifyContent: "center" },
  rule: { height: RULE, backgroundColor: c.ink },
  // The field takes the screen. Top-aligned, because Android centres a
  // multiline field's text vertically unless told otherwise.
  input: {
    ...t.body, color: c.ink, flex: 1, marginTop: sp.lg, padding: sp.md,
    borderWidth: 2, borderColor: c.ink, textAlignVertical: "top",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: sp.sm, paddingVertical: sp.lg },
  btn: { minHeight: TOUCH_MIN, paddingHorizontal: sp.lg, backgroundColor: c.ink, alignItems: "center", justifyContent: "center" },
  btnLabel: { ...t.micro, color: c.bg },
});
