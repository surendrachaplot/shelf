// fetch with a hard timeout. Every outbound call to a third party must use
// this: Node's fetch has no default timeout, so a hung socket wedges the
// request worker or the ingest drain indefinitely.
export async function fetchT(url, opts = {}, ms = 12000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A browser-shaped request. Instagram, recipe blogs and bookshops all serve
// different (or no) markup to something that announces itself as a script.
export const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// A bot wall is not an empty page — it is a page full of markup with no data in
// it. Detecting it explicitly is what stops "Just a moment..." being parsed as
// a title and filed as a book. Lifted from soundcheck-api/import.js, where it
// was learned on Cloudflare-fronted ticketing sites.
export function isBotWall(status, html) {
  if (status === 403 || status === 429) return true;
  return /just a moment|challenge-platform|cf-mitigated|enable javascript and cookies|login_and_signup_page|accounts\/login/i
    .test(String(html || "").slice(0, 4000));
}
