// Screen.tsx — the top of every screen, held off the status bar.
//
// This exists because the app SHIPPED with its header under the clock. The
// wordmark sat on top of "15:48", the battery overlapped the plate, and the
// Add button collided with the signal bars. Not subtle — the first thing you
// see on launch.
//
// It survived every check this project has, and the reason is worth writing
// down: THE RENDER HARNESS IS A BROWSER, and a browser window has no notch, no
// clock and no home indicator. react-native-web renders SafeAreaView as a
// plain div with `env(safe-area-inset-*)`, which is zero everywhere off a real
// device. So the contact sheet showed a perfectly composed header, twenty-nine
// times over, while the actual phone had it underneath the status bar.
// `preview/screenStub.jsx` now fakes the insets so the shots tell the truth.
//
// Every full-bleed screen goes through here or through KeyboardSafe (which
// wraps this). Overlays too — they are `position: absolute` at top 0, which is
// the top of the DISPLAY, not the top of the safe area.
import React from "react";
import { SafeAreaView, type ViewStyle } from "react-native";

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[] }) {
  // RN's own SafeAreaView, not react-native-safe-area-context: the latter is a
  // native module, and a native module cannot travel over the air. This is a
  // fix that has to reach a phone that is already in someone's pocket.
  return <SafeAreaView style={[{ flex: 1 }, style as ViewStyle]}>{children}</SafeAreaView>;
}
