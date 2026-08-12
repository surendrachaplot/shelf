import React from "react";
import { createRoot } from "react-dom/client";
import { AppRegistry } from "react-native";
import App from "../App";
import ShareExtension from "../ShareExtension";
import { ShareBoards } from "../src/ShareBoards";

import { SAFE_TOP } from "./screenStub.jsx";

const which = new URLSearchParams(location.search).get("screen") ?? "app";
const Root =
  which === "share" ? () => <ShareExtension url="https://www.instagram.com/reel/DAbCdEf/" />
  // ANDROID HAS NO SHEET. The same boards fill the whole screen inside the app,
  // which is a different composition problem: six bands over 800pt instead of
  // 420, with a status bar above them. Rendered separately because "it looks
  // right at 420" says nothing about how it looks at full height.
  : which === "android-share" ? () => (
      <ShareBoards url="https://www.instagram.com/reel/DAbCdEf/" hosted onDone={() => {}} />
    )
  : App;

// The share extension is a 320pt-tall sheet, not a full screen — render it in
// a box the size of the real thing or the layout judgement is worthless.
const isSheet = which === "share";   // the iOS sheet only; Android is full height
const root = document.getElementById("root");
root.style.height = isSheet ? "420px" : "100%";
root.style.width = "100%";
if (isSheet) root.style.boxShadow = "0 -8px 40px rgba(0,0,0,.18)";

AppRegistry.registerComponent("preview", () => Root);
AppRegistry.runApplication("preview", { rootTag: root });

// THE STATUS BAR, drawn on top of everything, outside React.
//
// The stub gives screens the right padding; this shows what happens to a
// screen that does not use it. The app shipped with the wordmark sitting on
// the clock and the battery over the profile plate, and no screenshot could
// ever have shown it, because a browser has no status bar to collide with.
// Now anything under this band is visibly under it.
//
// A sheet over another app has no status bar of its own, so it is skipped.
//
// ANDROID IS DIFFERENT AGAIN. Its window is inset BELOW the status bar (the
// generated theme sets no windowTranslucentStatus), so content never runs
// under the clock the way it does on iOS. Reproducing that here, rather than
// leaving a screenshot that shows an overlap the device does not have — a
// harness that lies in the safe direction still teaches you the wrong thing.
// NOT padding: the Android window is SHORTER, not taller. Padding the root
// pushed the last board and the "Decide for me" foot off the bottom of the
// screenshot — a distortion introduced by the harness, in the one shot meant
// to prove the layout fits.
if (which === "android-share") {
  root.style.marginTop = `${SAFE_TOP}px`;
  root.style.height = `calc(100% - ${SAFE_TOP}px)`;
}

if (!isSheet) {
  const bar = document.createElement("div");
  bar.style.cssText = `position:fixed;top:0;left:0;right:0;height:${SAFE_TOP}px;`
    + "pointer-events:none;z-index:9999;display:flex;align-items:flex-end;"
    + "justify-content:space-between;padding:0 28px 10px;font:600 15px/1 -apple-system,Helvetica,Arial,sans-serif;"
    + "color:rgba(128,128,128,.85);background:repeating-linear-gradient(135deg,"
    + "rgba(128,128,128,.10) 0 6px,transparent 6px 12px);";
  bar.innerHTML = "<span>15:48</span><span>▮▮▮ ᯤ 63</span>";
  document.body.appendChild(bar);
}
