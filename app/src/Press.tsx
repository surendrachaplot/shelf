// Press.tsx — the only way anything in this app responds to a finger.
//
// One component so the press feel cannot diverge between surfaces: a tile in
// the share sheet and a button in the Inbox must answer identically or the app
// reads as two apps. The spring is `springs.press`, which is critically damped
// on purpose — a control that bounces back reads as a bug, not as delight, and
// it is the single most common way "playful" motion turns into "cheap".
//
// The scale is SIZE-DEPENDENT. A 44pt button and a 320pt card scaling by the
// same factor is wrong: the same ratio that reads as a gentle push on a small
// control reads as a collapse on a large one. `pressScale` solves for a
// roughly constant *edge travel* instead.
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, type ViewStyle, type StyleProp } from "react-native";
import { springs, pressScale } from "./theme";

export function Press({
  children, onPress, disabled, style, size = 48, hitSlop = 8,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Longest edge in pt — drives how far the press scales. */
  size?: number;
  hitSlop?: number;
}) {
  const v = useRef(new Animated.Value(1)).current;
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setReduced(on));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  const to = (toValue: number) => {
    if (reduced) { v.setValue(1); return; }
    Animated.spring(v, {
      toValue,
      stiffness: springs.press.stiffness,
      damping: springs.press.damping,
      mass: springs.press.mass,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      // §4f — keep the painted size, expand the touchable area. This is the
      // React Native equivalent of the absolute ::after the web app uses, and
      // it is why a small control can stay small without failing the 44pt floor.
      hitSlop={hitSlop}
      onPressIn={() => to(pressScale(size))}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale: v }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
