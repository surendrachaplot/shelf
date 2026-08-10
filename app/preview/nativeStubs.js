export const close = () => { document.body.setAttribute("data-closed", "1"); };
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
