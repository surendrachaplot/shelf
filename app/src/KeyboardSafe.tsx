// KeyboardSafe.tsx — nothing you type into may sit under the keyboard.
//
// This exists because the PAIRING SCREEN shipped with the code field hidden
// behind the keyboard. Not a cosmetic problem: it is the one screen you cannot
// get past, on first launch, so the app was unusable and the failure was
// invisible in every screenshot — react-native-web has no keyboard, so the
// render harness could never have caught it.
//
// Two mechanisms, because the layouts differ:
//
//   <KeyboardSafe>      wraps a screen that is NOT a scroll view (the pairing
//                       screen, the share panel). Shrinks the frame so the
//                       content is laid out in what is left.
//
//   scrollKeyboardProps spread onto a ScrollView that contains inputs. iOS
//                       insets the scroll content by the keyboard itself,
//                       which is better than shrinking: the view keeps its
//                       size and just scrolls further.
//
// `keyboardShouldPersistTaps: "handled"` is in there because without it the
// first tap after typing is swallowed dismissing the keyboard — so a person
// taps Save, nothing happens, and they tap it again.
import React from "react";
import { KeyboardAvoidingView, Platform, type ViewStyle } from "react-native";
import { Screen } from "./Screen";

export function KeyboardSafe({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      // `padding` is the correct behaviour on iOS; Android resizes the window
      // itself and `height` double-counts unless you say so.
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* INSIDE the avoider, not around it: the caller's background colour is
          on the avoider, so the safe area is painted rather than left as a
          white bar above a coloured panel. Every screen reaching for
          KeyboardSafe gets the notch handled without having to ask. */}
      <Screen>{children}</Screen>
    </KeyboardAvoidingView>
  );
}

/** Spread onto any ScrollView that contains a TextInput. */
export const scrollKeyboardProps = {
  keyboardShouldPersistTaps: "handled" as const,
  // iOS only, and a no-op elsewhere: insets the content by the keyboard's
  // height rather than resizing the view.
  automaticallyAdjustKeyboardInsets: true,
};
