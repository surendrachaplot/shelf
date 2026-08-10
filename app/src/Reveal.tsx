// Reveal.tsx — staggered entrance for list rows.
//
// The stagger is capped at 8 steps (`staggerDelay`), which is the difference
// between craft and the app feeling slow: past about a third of a second the
// eye stops reading it as choreography and starts reading it as waiting. Rows
// beyond the eighth all share the last delay, so a 200-item shelf enters in
// the same time as an 8-item one.
//
// Under reduced motion this renders immediately at full opacity — not a faster
// animation, none. A person who asked the OS to stop moving things has asked
// for exactly that.
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, type StyleProp, type ViewStyle } from "react-native";
import { springs, staggerDelay } from "./theme";

export function Reveal({ index = 0, children, style }: {
  index?: number;
  children: React.ReactNode;
  // A wrapper inside a flex row is a flex CHILD. Without somewhere to put the
  // sizing, wrapping a 48%-wide tile in a Reveal silently collapses it to
  // content width — which is exactly how the share sheet's 2x2 grid rendered
  // as four narrow pills with the labels overflowing them.
  style?: StyleProp<ViewStyle>;
}) {
  const [reduced, setReduced] = useState<boolean | null>(null);
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => alive && setReduced(on));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (reduced === null) return;      // don't animate before we know
    if (reduced) { v.setValue(1); return; }
    const id = setTimeout(() => {
      Animated.spring(v, {
        toValue: 1,
        stiffness: springs.enter.stiffness,
        damping: springs.enter.damping,
        mass: springs.enter.mass,
        useNativeDriver: true,
      }).start();
    }, staggerDelay(index));
    return () => clearTimeout(id);
  }, [reduced, index, v]);

  // Opacity and a short rise, both off the same driver so they cannot
  // desynchronise. 10pt is deliberately small — a row that flies in from far
  // away draws attention to the animation rather than to the content.
  return (
    <Animated.View
      style={[style, {
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}
