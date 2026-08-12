// ShareExtension.tsx — the iOS host for the picker.
//
// This file used to BE the sheet. It is now the twelve lines that are actually
// iOS-specific: expo-share-extension hands over what was shared and gives us a
// `close()`, and everything drawn on screen lives in `src/ShareBoards.tsx`
// because Android renders exactly the same thing from inside the app.
//
// Keep it thin. Anything added here is, by definition, something Android will
// not get — which is how two share sheets end up disagreeing about what a
// saved reel looks like.
import React from "react";
import { close, type InitialProps } from "expo-share-extension";
import { ShareBoards } from "./src/ShareBoards";

export default function ShareExtension({ url, text, images }: InitialProps) {
  return <ShareBoards url={url} text={text} images={images} onDone={close} />;
}
