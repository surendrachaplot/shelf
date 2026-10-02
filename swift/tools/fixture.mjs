// fixture.mjs — Resources/Debug/shelf.json: the SAME shelf the Expo preview
// harness draws (app/preview/storeStub.js), so a Swift screen and its Expo
// screenshot show the same things and can be compared side by side.
//
// The stub is browser code (it reads location.search), so it is given a fake
// one. Its artwork is inline SVG, which UIKit cannot draw — those covers
// become typographic jackets here, which is the case worth looking at anyway.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

globalThis.location = { search: "" };
const stub = await import("../../app/preview/storeStub.js");
const { shelf } = await stub.load();
const items = shelf.items.map((i) => ({ ...i, image_url: /^data:image\/svg/.test(i.image_url || "") ? null : i.image_url }));
const out = fileURLToPath(new URL("../Resources/Debug/shelf.json", import.meta.url));
writeFileSync(out, JSON.stringify({ ...shelf, items }, null, 1));
console.log(`wrote ${out}: ${items.length} items, ${shelf.boards.length} lists`);
