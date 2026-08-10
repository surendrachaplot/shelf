import React from "react";
import { createRoot } from "react-dom/client";
import { AppRegistry } from "react-native";
import App from "../App";
import ShareExtension from "../ShareExtension";

const which = new URLSearchParams(location.search).get("screen") ?? "app";
const Screen = which === "share"
  ? () => <ShareExtension url="https://www.instagram.com/reel/DAbCdEf/" />
  : App;

// The share extension is a 320pt-tall sheet, not a full screen — render it in
// a box the size of the real thing or the layout judgement is worthless.
const isSheet = which === "share";
const root = document.getElementById("root");
root.style.height = isSheet ? "420px" : "100%";
root.style.width = "100%";
if (isSheet) root.style.boxShadow = "0 -8px 40px rgba(0,0,0,.18)";

AppRegistry.registerComponent("preview", () => Screen);
AppRegistry.runApplication("preview", { rootTag: root });
