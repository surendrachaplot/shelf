// variants.js — six complete design systems for shelf, rendered side by side.
//
// This is an exploration round, so these are HTML/CSS rather than the shipping
// component tree — but everything here is deliberately restricted to what
// React Native can express (flexbox, borders, radii, shadows, gradients via
// expo-linear-gradient, blur via expo-blur). Nothing below is a mock that
// would have to be faked to build.
//
// Fonts are stand-ins for what would ship: Bitstream Charter stands in for a
// licensed transitional serif or New York; Liberation Sans for Helvetica/SF;
// DejaVu Sans Mono for a licensed grotesque mono. The SHAPE of each direction
// is what is being judged, not the specific cut.
//
// NO BEIGE anywhere. Each direction moves type, structure, depth model and
// shape language — not just the palette.

const LISTS = [
  { key: "books", label: "Books", n: "01" },
  { key: "restaurants", label: "Restaurants", n: "02" },
  { key: "movies", label: "Movies", n: "03" },
  { key: "recipes", label: "Recipes", n: "04" },
];

// The drawn marks, same family as the shipping set: 24 grid, one weight.
const ICONS = {
  books: '<rect x="4.5" y="6.25" width="3.6" height="12.25" rx="1"/><rect x="10.2" y="3.75" width="3.6" height="14.75" rx="1"/><rect x="15.9" y="8.25" width="3.6" height="10.25" rx="1"/><path d="M3 20.5 H21"/>',
  restaurants: '<path d="M7.25 3.5 v4.4 a3 3 0 0 0 6 0 V3.5"/><path d="M10.25 3.5 v4.4"/><path d="M10.25 10.9 V20.5"/><path d="M17.25 3.5 c1.9 2.1 1.9 6.1 0 8 V20.5"/>',
  movies: '<rect x="3.25" y="4.75" width="17.5" height="14.5" rx="2.5"/><path d="M8 4.75 V19.25"/><path d="M16 4.75 V19.25"/><path d="M8 12 H16"/>',
  recipes: '<path d="M4.75 11.5 h11 v4.25 a3 3 0 0 1 -3 3 h-5 a3 3 0 0 1 -3 -3 Z"/><path d="M15.75 13 H19.5"/><path d="M8 8.5 c0 -1.5 1.5 -1.5 1.5 -3"/><path d="M12 8.5 c0 -1.5 1.5 -1.5 1.5 -3"/>',
  chevron: '<path d="M9.75 5.5 L16.25 12 L9.75 18.5"/>',
};
const ico = (name, size, color, sw = 1.75) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}"
     stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const ITEM = {
  title: "Ganapati",
  sub: "38 Holly Grove, Peckham",
  note: "Get the dosa. Go early, they don't take bookings after 7.",
};
const ITEM2 = { title: "Piranesi", sub: "Susanna Clarke", note: "Could not put it down." };

const VARIANTS = [];

// ─────────────────────────────────────────────────────────────────────────────
// 1. MIDNIGHT — the film archive.
// No cards at all. Hairline rules, huge serif, one hot colour per list used as
// a 6pt dot and nothing else. Restraint carries it.
// ─────────────────────────────────────────────────────────────────────────────
VARIANTS.push({
  name: "01 Midnight",
  render() {
    const C = { bg: "#0B0B0C", ink: "#F2F1EE", soft: "#8A8880", rule: "#212024" };
    const tint = { books: "#E8B04B", restaurants: "#E4573D", movies: "#A78BFA", recipes: "#A3E635" };
    const row = (l) => `
      <div style="display:flex;align-items:center;gap:16px;padding:19px 24px;border-bottom:1px solid ${C.rule}">
        <span style="width:7px;height:7px;border-radius:99px;background:${tint[l.key]};flex:none"></span>
        <span style="font:400 25px/1.1 'Bitstream Charter',serif;color:${C.ink};letter-spacing:-.2px;flex:1">${l.label}</span>
        ${ico("chevron", 15, C.soft, 1.5)}
      </div>`;
    const item = (it, k, big) => `
      <div style="display:flex;gap:16px;padding:20px 24px;border-bottom:1px solid ${C.rule}">
        <div style="flex:1">
          <div style="font:400 ${big ? 23 : 20}px/1.15 'Bitstream Charter',serif;color:${C.ink};letter-spacing:-.2px">${it.title}</div>
          <div style="font:400 12px/1.5 'Liberation Sans',sans-serif;color:${C.soft};margin-top:5px;letter-spacing:.2px">${it.sub}</div>
          <div style="font:italic 400 14px/1.5 'Bitstream Charter',serif;color:#B4B1A9;margin-top:9px">${it.note}</div>
        </div>
        <div style="width:52px;height:74px;background:#17171A;border:1px solid ${C.rule};flex:none;display:flex;align-items:center;justify-content:center">
          ${ico(k, 20, tint[k], 1.5)}
        </div>
      </div>`;
    return `
    <div class="screen sheet" style="background:${C.bg}">
      <div style="padding:26px 24px 14px">
        <div style="font:400 10px/1 'Liberation Sans',sans-serif;color:${C.soft};letter-spacing:2.4px;text-transform:uppercase">Save to</div>
        <div style="font:400 13px/1 'Liberation Sans',sans-serif;color:#5F5D58;margin-top:9px">Instagram reel</div>
      </div>
      <div style="border-top:1px solid ${C.rule}">${LISTS.map(row).join("")}</div>
      <div style="text-align:center;padding:20px;font:400 12px/1 'Liberation Sans',sans-serif;color:#5F5D58;letter-spacing:.3px">Let shelf decide</div>
    </div>
    <div class="screen app" style="background:${C.bg}">
      <div style="padding:30px 24px 18px">
        <div style="font:400 40px/1 'Bitstream Charter',serif;color:${C.ink};letter-spacing:-1.2px">shelf</div>
      </div>
      <div style="display:flex;gap:22px;padding:0 24px 16px;border-bottom:1px solid ${C.rule}">
        ${["Inbox", "Books", "Restaurants"].map((x, i) => `
          <span style="font:400 13px/1 'Liberation Sans',sans-serif;color:${i === 0 ? C.ink : C.soft};letter-spacing:.2px;
            padding-bottom:12px;border-bottom:1px solid ${i === 0 ? "#E4573D" : "transparent"};margin-bottom:-17px">${x}</span>`).join("")}
      </div>
      ${item(ITEM, "restaurants", true)}${item(ITEM2, "books", false)}
    </div>`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. INDEX — the card catalogue.
// Literal: ruled cards, a red margin rule, monospace call-numbers. Nostalgic
// without being a skeuomorph — the rules are real structure, not texture.
// ─────────────────────────────────────────────────────────────────────────────
VARIANTS.push({
  name: "02 Index",
  render() {
    const C = { bg: "#EDF0F4", card: "#FFFFFF", ink: "#141C2B", soft: "#5D6577", rule: "#D5DCE6", red: "#C0392B" };
    const tint = { books: "#1B4C8C", restaurants: "#C0392B", movies: "#5B3A8C", recipes: "#1F6B4A" };
    const row = (l) => `
      <div style="background:${C.card};border:1px solid ${C.rule};border-left:3px solid ${tint[l.key]};
                  display:flex;align-items:center;gap:14px;padding:15px 14px;border-radius:2px">
        ${ico(l.key, 20, tint[l.key], 1.6)}
        <span style="font:400 19px/1 'Bitstream Charter',serif;color:${C.ink};flex:1">${l.label}</span>
        <span style="font:400 10px/1 'DejaVu Sans Mono',monospace;color:${C.soft};letter-spacing:.6px">${l.n}</span>
      </div>`;
    const item = (it, k) => `
      <div style="background:${C.card};border:1px solid ${C.rule};border-radius:2px;position:relative;overflow:hidden">
        <div style="position:absolute;left:34px;top:0;bottom:0;width:1px;background:${C.red};opacity:.35"></div>
        <div style="padding:14px 14px 14px 48px">
          <div style="font:400 9px/1 'DejaVu Sans Mono',monospace;color:${C.soft};letter-spacing:1.2px;text-transform:uppercase">${k} · saved today</div>
          <div style="font:400 22px/1.15 'Bitstream Charter',serif;color:${C.ink};margin-top:7px">${it.title}</div>
          <div style="font:400 12px/1.5 'Liberation Sans',sans-serif;color:${C.soft};margin-top:3px">${it.sub}</div>
          <div style="border-top:1px solid ${C.rule};margin-top:11px;padding-top:9px;
                      font:italic 400 13px/1.5 'Bitstream Charter',serif;color:#3E4759">${it.note}</div>
        </div>
      </div>`;
    return `
    <div class="screen sheet" style="background:${C.bg};padding:22px 18px">
      <div style="font:400 10px/1 'DejaVu Sans Mono',monospace;color:${C.soft};letter-spacing:2px;text-transform:uppercase">File under</div>
      <div style="font:400 13px/1 'Liberation Sans',sans-serif;color:${C.ink};margin-top:8px;margin-bottom:16px">Instagram reel</div>
      <div style="display:flex;flex-direction:column;gap:8px">${LISTS.map(row).join("")}</div>
      <div style="text-align:center;margin-top:18px;font:400 11px/1 'DejaVu Sans Mono',monospace;color:${C.soft};letter-spacing:.8px">[ UNSORTED ]</div>
    </div>
    <div class="screen app" style="background:${C.bg};padding:26px 18px">
      <div style="display:flex;align-items:baseline;gap:9px">
        <div style="font:400 32px/1 'Bitstream Charter',serif;color:${C.ink};letter-spacing:-.6px">shelf</div>
        <div style="font:400 10px/1 'DejaVu Sans Mono',monospace;color:${C.soft};letter-spacing:1px">CAT. 2026</div>
      </div>
      <div style="display:flex;gap:6px;margin:18px 0 14px">
        ${["INBOX", "BOOKS", "PLACES"].map((x, i) => `
          <span style="font:400 10px/1 'DejaVu Sans Mono',monospace;letter-spacing:1px;padding:7px 10px;border-radius:2px 2px 0 0;
            background:${i === 0 ? C.ink : "transparent"};color:${i === 0 ? "#FFF" : C.soft};
            border:1px solid ${i === 0 ? C.ink : C.rule};border-bottom:none">${x}</span>`).join("")}
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">${item(ITEM, "restaurants")}${item(ITEM2, "books")}</div>
    </div>`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. KIOSK — the Swiss poster.
// Radius zero. Type IS the icon. Each list is a saturated field with a number.
// Loud on purpose: the share sheet becomes four targets you hit without reading.
// ─────────────────────────────────────────────────────────────────────────────
VARIANTS.push({
  name: "03 Kiosk",
  render() {
    const C = { bg: "#FFFFFF", ink: "#000000" };
    const tint = { books: "#0B3EE3", restaurants: "#FF2D16", movies: "#111111", recipes: "#00A050" };
    const on = { books: "#FFFFFF", restaurants: "#FFFFFF", movies: "#FFD400", recipes: "#FFFFFF" };
    const block = (l) => `
      <div style="background:${tint[l.key]};padding:14px 16px;display:flex;align-items:baseline;gap:12px">
        <span style="font:700 12px/1 'Liberation Sans',sans-serif;color:${on[l.key]};opacity:.6;letter-spacing:.5px">${l.n}</span>
        <span style="font:700 30px/1 'Liberation Sans',sans-serif;color:${on[l.key]};letter-spacing:-1.4px;text-transform:uppercase;flex:1">${l.label}</span>
      </div>`;
    const item = (it, k) => `
      <div style="border-top:3px solid ${C.ink};padding:14px 0">
        <div style="display:flex;gap:12px">
          <div style="width:8px;background:${tint[k]};flex:none"></div>
          <div style="flex:1">
            <div style="font:700 11px/1 'Liberation Sans',sans-serif;color:${tint[k]};letter-spacing:1.4px;text-transform:uppercase">${k}</div>
            <div style="font:700 27px/1.02 'Liberation Sans',sans-serif;color:${C.ink};letter-spacing:-1.2px;margin-top:7px">${it.title}</div>
            <div style="font:400 13px/1.4 'Liberation Sans',sans-serif;color:#444;margin-top:6px">${it.sub}</div>
            <div style="font:400 14px/1.45 'Liberation Sans',sans-serif;color:${C.ink};margin-top:9px">${it.note}</div>
          </div>
        </div>
      </div>`;
    return `
    <div class="screen sheet" style="background:${C.bg};display:flex;flex-direction:column">
      <div style="padding:20px 16px 12px">
        <div style="font:700 11px/1 'Liberation Sans',sans-serif;letter-spacing:2px;text-transform:uppercase">Save to →</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;padding:0 3px">${LISTS.map(block).join("")}</div>
      <div style="margin-top:auto;padding:14px 16px;border-top:3px solid ${C.ink};
                  font:700 12px/1 'Liberation Sans',sans-serif;letter-spacing:1px;text-transform:uppercase">Decide for me</div>
    </div>
    <div class="screen app" style="background:${C.bg};padding:24px 16px">
      <div style="font:700 46px/.9 'Liberation Sans',sans-serif;letter-spacing:-3px;text-transform:lowercase">shelf</div>
      <div style="display:flex;gap:0;margin:20px 0 4px">
        ${["INBOX", "BOOKS", "PLACES", "FILM"].map((x, i) => `
          <span style="font:700 10px/1 'Liberation Sans',sans-serif;letter-spacing:1px;padding:8px 11px;
            background:${i === 0 ? C.ink : "transparent"};color:${i === 0 ? "#FFF" : "#888"}">${x}</span>`).join("")}
      </div>
      ${item(ITEM, "restaurants")}${item(ITEM2, "books")}
      <div style="border-top:3px solid ${C.ink}"></div>
    </div>`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. AURORA — glass and light.
// Deep field, luminous orbs behind translucent panels. Every surface is a pane
// with light behind it. Buildable with expo-blur + expo-linear-gradient.
// ─────────────────────────────────────────────────────────────────────────────
VARIANTS.push({
  name: "04 Aurora",
  render() {
    const C = { bg: "#08070E", ink: "#F4F3FA", soft: "#9B98B4" };
    const tint = { books: "#6EA8FF", restaurants: "#FF8FA3", movies: "#B98BFF", recipes: "#5EE7C0" };
    const orbs = `
      <div style="position:absolute;top:-90px;left:-70px;width:300px;height:300px;border-radius:99px;
        background:radial-gradient(circle,#3B2A78 0%,rgba(59,42,120,0) 70%);filter:blur(28px)"></div>
      <div style="position:absolute;bottom:-110px;right:-80px;width:320px;height:320px;border-radius:99px;
        background:radial-gradient(circle,#0E5C6B 0%,rgba(14,92,107,0) 70%);filter:blur(28px)"></div>`;
    const pane = "background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(20px)";
    const row = (l) => `
      <div style="${pane};border-radius:20px;display:flex;align-items:center;gap:14px;padding:15px 16px">
        <span style="width:34px;height:34px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;
          background:${tint[l.key]}1F;border:1px solid ${tint[l.key]}33">${ico(l.key, 18, tint[l.key], 1.6)}</span>
        <span style="font:400 18px/1 'Liberation Sans',sans-serif;color:${C.ink};letter-spacing:-.2px;flex:1">${l.label}</span>
        ${ico("chevron", 15, "rgba(255,255,255,.28)", 1.5)}
      </div>`;
    const item = (it, k) => `
      <div style="${pane};border-radius:24px;padding:16px;display:flex;gap:14px">
        <div style="width:58px;height:58px;border-radius:16px;flex:none;display:flex;align-items:center;justify-content:center;
          background:linear-gradient(160deg,${tint[k]}30,${tint[k]}0A);border:1px solid ${tint[k]}2E">${ico(k, 24, tint[k], 1.6)}</div>
        <div style="flex:1">
          <div style="font:400 19px/1.15 'Liberation Sans',sans-serif;color:${C.ink};letter-spacing:-.3px">${it.title}</div>
          <div style="font:400 12px/1.45 'Liberation Sans',sans-serif;color:${C.soft};margin-top:4px">${it.sub}</div>
          <div style="font:400 13px/1.5 'Liberation Sans',sans-serif;color:#C6C3D8;margin-top:8px">${it.note}</div>
        </div>
      </div>`;
    return `
    <div class="screen sheet" style="background:${C.bg};position:relative;padding:22px 16px">
      ${orbs}
      <div style="position:relative">
        <div style="font:400 10px/1 'Liberation Sans',sans-serif;color:${C.soft};letter-spacing:2.2px;text-transform:uppercase">Save to</div>
        <div style="font:400 13px/1 'Liberation Sans',sans-serif;color:rgba(255,255,255,.42);margin-top:8px;margin-bottom:16px">Instagram reel</div>
        <div style="display:flex;flex-direction:column;gap:9px">${LISTS.map(row).join("")}</div>
        <div style="text-align:center;margin-top:18px;font:400 12px/1 'Liberation Sans',sans-serif;color:${C.soft}">Let shelf decide</div>
      </div>
    </div>
    <div class="screen app" style="background:${C.bg};position:relative;padding:28px 16px">
      ${orbs}
      <div style="position:relative">
        <div style="font:300 34px/1 'Liberation Sans',sans-serif;color:${C.ink};letter-spacing:-1.4px">shelf</div>
        <div style="display:flex;gap:7px;margin:20px 0 16px">
          ${["Inbox", "Books", "Places"].map((x, i) => `
            <span style="font:400 12px/1 'Liberation Sans',sans-serif;padding:9px 14px;border-radius:99px;
              background:${i === 0 ? "rgba(255,255,255,.12)" : "transparent"};
              border:1px solid ${i === 0 ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.07)"};
              color:${i === 0 ? C.ink : C.soft}">${x}</span>`).join("")}
        </div>
        <div style="display:flex;flex-direction:column;gap:11px">${item(ITEM, "restaurants")}${item(ITEM2, "books")}</div>
      </div>
    </div>`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. TERMINAL — the tool.
// Monospace everywhere, dot leaders, zero radius, one phosphor accent. Nothing
// decorative survives. Fastest to scan, hardest to love.
// ─────────────────────────────────────────────────────────────────────────────
VARIANTS.push({
  name: "05 Terminal",
  render() {
    const C = { bg: "#0A0B0A", ink: "#DDE3DC", soft: "#5F6B5E", rule: "#1B211B", acc: "#38E07B" };
    const M = "'DejaVu Sans Mono',monospace";
    const row = (l, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid ${C.rule}">
        <span style="font:400 12px/1 ${M};color:${C.acc}">[${i + 1}]</span>
        <span style="font:400 14px/1 ${M};color:${C.ink};letter-spacing:.4px;text-transform:uppercase">${l.label}</span>
        <span style="flex:1;border-bottom:1px dotted ${C.rule};transform:translateY(-3px)"></span>
        <span style="font:400 12px/1 ${M};color:${C.soft}">↵</span>
      </div>`;
    const item = (it, k, id) => `
      <div style="border-bottom:1px solid ${C.rule};padding:14px 16px">
        <div style="font:400 10px/1 ${M};color:${C.soft};letter-spacing:.8px">
          <span style="color:${C.acc}">${id}</span> · ${k.toUpperCase()} · conf 0.94
        </div>
        <div style="font:700 16px/1.2 ${M};color:${C.ink};margin-top:8px;letter-spacing:-.2px">${it.title}</div>
        <div style="font:400 12px/1.5 ${M};color:${C.soft};margin-top:4px">${it.sub}</div>
        <div style="font:400 12px/1.55 ${M};color:#9AA598;margin-top:8px;padding-left:10px;border-left:2px solid ${C.rule}">${it.note}</div>
      </div>`;
    return `
    <div class="screen sheet" style="background:${C.bg}">
      <div style="padding:18px 16px 14px;border-bottom:1px solid ${C.rule}">
        <div style="font:400 11px/1 ${M};color:${C.soft};letter-spacing:.6px">shelf ~ save</div>
        <div style="font:400 13px/1 ${M};color:${C.ink};margin-top:9px">instagram/reel<span style="color:${C.acc}">_</span></div>
      </div>
      ${LISTS.map(row).join("")}
      <div style="padding:15px 16px;font:400 12px/1 ${M};color:${C.soft};letter-spacing:.4px">[0] auto-classify</div>
    </div>
    <div class="screen app" style="background:${C.bg}">
      <div style="padding:20px 16px 14px;border-bottom:1px solid ${C.rule}">
        <div style="font:700 22px/1 ${M};color:${C.ink};letter-spacing:-.6px">shelf<span style="color:${C.acc}">.</span></div>
        <div style="font:400 11px/1 ${M};color:${C.soft};margin-top:8px">4 lists · 2 pending · synced 14:02</div>
      </div>
      <div style="display:flex;border-bottom:1px solid ${C.rule}">
        ${["inbox", "books", "places", "film"].map((x, i) => `
          <span style="font:400 11px/1 ${M};padding:11px 12px;letter-spacing:.4px;
            color:${i === 0 ? C.bg : C.soft};background:${i === 0 ? C.acc : "transparent"}">${x}</span>`).join("")}
      </div>
      ${item(ITEM, "restaurants", "i_4a91")}${item(ITEM2, "books", "i_7c02")}
    </div>`;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. ATELIER — the quarterly.
// Cool paper, deep ink, generous air. Content-forward: the note is the hero and
// gets real display type. Slowest and most considered of the six.
// ─────────────────────────────────────────────────────────────────────────────
VARIANTS.push({
  name: "06 Atelier",
  render() {
    const C = { bg: "#ECEFF1", card: "#FFFFFF", ink: "#16232B", soft: "#65747C", rule: "#D3DBE0" };
    const tint = { books: "#2B4570", restaurants: "#7C2D3A", movies: "#56344F", recipes: "#1F4D36" };
    const row = (l) => `
      <div style="display:flex;align-items:center;gap:16px;padding:17px 4px;border-bottom:1px solid ${C.rule}">
        ${ico(l.key, 21, tint[l.key], 1.5)}
        <span style="font:400 22px/1 'Bitstream Charter',serif;color:${C.ink};letter-spacing:-.2px;flex:1">${l.label}</span>
        <span style="font:400 9px/1 'Liberation Sans',sans-serif;color:${C.soft};letter-spacing:2px">${l.n}</span>
      </div>`;
    const item = (it, k, hero) => `
      <div style="background:${C.card};padding:${hero ? 22 : 18}px;box-shadow:0 1px 2px rgba(22,35,43,.05),0 8px 24px rgba(22,35,43,.06)">
        <div style="font:400 9px/1 'Liberation Sans',sans-serif;color:${tint[k]};letter-spacing:2.4px;text-transform:uppercase">${k}</div>
        <div style="font:400 ${hero ? 30 : 24}px/1.12 'Bitstream Charter',serif;color:${C.ink};margin-top:11px;letter-spacing:-.4px">${it.title}</div>
        <div style="font:400 12px/1.5 'Liberation Sans',sans-serif;color:${C.soft};margin-top:6px">${it.sub}</div>
        ${hero ? `<div style="font:italic 400 17px/1.5 'Bitstream Charter',serif;color:#33454F;margin-top:16px;
                    padding-top:16px;border-top:1px solid ${C.rule}">“${it.note}”</div>` : ""}
      </div>`;
    return `
    <div class="screen sheet" style="background:${C.bg};padding:28px 24px">
      <div style="font:400 9px/1 'Liberation Sans',sans-serif;color:${C.soft};letter-spacing:2.6px;text-transform:uppercase">Save to</div>
      <div style="font:400 14px/1 'Bitstream Charter',serif;color:${C.ink};margin-top:10px;margin-bottom:14px">An Instagram reel</div>
      <div style="border-top:1px solid ${C.rule}">${LISTS.map(row).join("")}</div>
      <div style="text-align:center;margin-top:20px;font:italic 400 14px/1 'Bitstream Charter',serif;color:${C.soft}">or let shelf decide</div>
    </div>
    <div class="screen app" style="background:${C.bg};padding:30px 20px">
      <div style="font:400 38px/1 'Bitstream Charter',serif;color:${C.ink};letter-spacing:-1px">shelf</div>
      <div style="display:flex;gap:20px;margin:22px 0 20px;border-bottom:1px solid ${C.rule};padding-bottom:12px">
        ${["Inbox", "Books", "Places"].map((x, i) => `
          <span style="font:400 12px/1 'Liberation Sans',sans-serif;letter-spacing:.6px;
            color:${i === 0 ? C.ink : C.soft};border-bottom:2px solid ${i === 0 ? "#7C2D3A" : "transparent"};
            padding-bottom:12px;margin-bottom:-13px">${x}</span>`).join("")}
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">${item(ITEM, "restaurants", true)}${item(ITEM2, "books", false)}</div>
    </div>`;
  },
});
