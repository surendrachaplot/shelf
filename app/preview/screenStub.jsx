// The notch, faked, so the contact sheet stops lying.
//
// `src/Screen.tsx` uses React Native's SafeAreaView. react-native-web renders
// that as a plain div with `env(safe-area-inset-*)`, and in a headless Chromium
// those are all ZERO. So the harness rendered every screen as if the phone had
// no status bar, no notch and no home indicator — and the app shipped with its
// wordmark on top of the clock and the battery icon over the profile plate.
// Twenty-nine screenshots, all of them clean, all of them wrong.
//
// The numbers are an iPhone 15/16 in portrait: 59pt of status bar, 34pt of home
// indicator. The exact model matters less than the fact that it is not zero.
//
// `entry.jsx` also paints a band over the top 59pt of every shot, OUTSIDE this
// component — so a screen that forgets to use Screen has its content visibly
// underneath it, which is precisely how the real defect looked.
import React from "react";
import { View } from "react-native";

export const SAFE_TOP = 59;
export const SAFE_BOTTOM = 34;

export function Screen({ children, style }) {
  return (
    <View style={[{ flex: 1, paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM }, style]}>
      {children}
    </View>
  );
}
