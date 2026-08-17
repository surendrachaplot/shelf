// web/picker.js — expo-image-picker and expo-image-manipulator, in a browser.
//
// This is the one place the web version is arguably BETTER than the phone.
// There is no permission to ask for and no dialog to be denied: a file input
// shows the OS picker, the person chooses, and the page receives exactly what
// they chose and nothing else. The permission model is the interaction.
//
// So `requestMediaLibraryPermissionsAsync` returns granted — not as a lie, but
// because on this platform there is genuinely nothing to grant. The screen's
// "denied" branch is unreachable here and that is the honest state.

export const MediaTypeOptions = { Images: "Images", All: "All", Videos: "Videos" };
export const PermissionStatus = { GRANTED: "granted", DENIED: "denied", UNDETERMINED: "undetermined" };

export async function requestMediaLibraryPermissionsAsync() {
  return { granted: true, status: PermissionStatus.GRANTED, canAskAgain: true };
}
export const getMediaLibraryPermissionsAsync = requestMediaLibraryPermissionsAsync;

/**
 * The file input, opened from the tap that called this.
 *
 * IT MUST BE THE SAME TASK AS THE CLICK. A browser only opens a file dialog
 * from a user gesture, and an `await` before `input.click()` spends the
 * gesture — the dialog then never appears, with no error anywhere. That is why
 * nothing is awaited above this line.
 */
export async function launchImageLibraryAsync(opts = {}) {
  if (typeof document === "undefined") return { canceled: true, assets: [] };
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = opts.allowsMultipleSelection !== false;
  input.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0";
  document.body.appendChild(input);

  const picked = await new Promise((resolve) => {
    // A cancelled dialog fires NO change event in most browsers, so the
    // promise would hang forever and the Import screen would sit on its
    // spinner. `cancel` covers the browsers that have it; the window regaining
    // focus covers the rest.
    let done = false;
    const finish = (files) => { if (!done) { done = true; resolve(files); } };
    input.addEventListener("change", () => finish(Array.from(input.files || [])));
    input.addEventListener("cancel", () => finish([]));
    globalThis.addEventListener?.("focus", () => setTimeout(() => finish([]), 500), { once: true });
    input.click();
  });

  input.remove();
  const limit = opts.selectionLimit || 20;
  const assets = picked.slice(0, limit).map((f) => ({
    // An object URL, which web/fs.js knows how to read as base64. It stays
    // valid for the life of the document, which outlasts the resolve.
    uri: URL.createObjectURL(f),
    fileName: f.name,
    mimeType: f.type,
    width: 0, height: 0,
  }));
  return { canceled: assets.length === 0, assets };
}

// ── expo-image-manipulator ───────────────────────────────────────────────────

export const SaveFormat = { JPEG: "jpeg", PNG: "png", WEBP: "webp" };

/**
 * Resize and re-encode through a canvas.
 *
 * Only the two operations screenshots.ts actually asks for — resize by width,
 * and a JPEG at a quality — because a general implementation of a native
 * module's whole API is a large amount of code standing behind one call site.
 */
export async function manipulateAsync(uri, actions = [], opts = {}) {
  const img = await loadImage(uri);
  const resize = actions.find((a) => a && a.resize)?.resize || {};
  const scale = resize.width ? Math.min(1, resize.width / (img.width || 1)) : 1;
  const w = Math.max(1, Math.round((img.width || 1) * scale));
  const h = Math.max(1, Math.round((img.height || 1) * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);

  const type = opts.format === SaveFormat.PNG ? "image/png" : "image/jpeg";
  const dataUrl = canvas.toDataURL(type, opts.compress ?? 0.75);
  return { uri: dataUrl, width: w, height: h, base64: dataUrl.split(",")[1] || "" };
}

function loadImage(uri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Same-origin blob: URLs do not need this, but a remote cover would, and
    // a tainted canvas throws only at toDataURL — long after the mistake.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("that picture could not be opened"));
    img.src = uri;
  });
}
