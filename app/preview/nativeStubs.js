export const close = () => { document.body.setAttribute("data-closed", "1"); };

// expo-share-intent. The harness never receives a real Android intent, so the
// hook reports "nothing shared" — which is the state every screenshot except
// the share one is taken in. The Android boards are rendered directly instead
// (?screen=android-share), because a hook that can only return null cannot
// show you what an incoming share looks like.
export const useShareIntent = () => ({
  hasShareIntent: false, shareIntent: null, resetShareIntent: () => {}, error: null,
});
export const openHostApp = () => {};
export const clearAppGroupContainer = () => {};
export const readAsStringAsync = async () => "";
export const EncodingType = { Base64: "base64" };
export const getItemAsync = async () => null;
export const setItemAsync = async () => {};
export const deleteItemAsync = async () => {};
// expo-linear-gradient has no web build in this harness; a flat View is a fair
// stand-in for judging LAYOUT, and the fade itself is judged on device.
import React from "react";
import { View } from "react-native";
export const LinearGradient = ({ style, children }) => React.createElement(View, { style }, children);
