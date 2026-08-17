// web/entry.jsx — the app, in a tab.
//
// The SAME App.tsx the phone runs. Not a port, not a cut-down version: the
// six native modules are swapped in web/build.mjs and everything above them —
// every screen, the ranking, the store with its atomic writes and its
// rescue — is the code that ships in the binary.
//
// That is the whole design of this. A second implementation of a shelf is a
// second set of the same bugs, arriving later and separately.
import React from "react";
import { AppRegistry } from "react-native";
import App from "../App";

// react-native-web writes its styles into the document head at register time;
// the height rules make the root fill the window, which a div does not do on
// its own the way a native root view does.
const root = document.getElementById("root");
AppRegistry.registerComponent("shelf", () => App);
AppRegistry.runApplication("shelf", { rootTag: root });

// A tab has no splash screen, so the first paint is whatever the browser had.
// Removing the boot markup only once React has mounted means no flash of an
// empty page between them.
document.getElementById("boot")?.remove();
