// isMain(import.meta.url) — true only when this file is what node was asked to
// run, not when something imported it.
//
// This exists because of a bug it already caused: every module here ends with
// `if (process.argv.includes("--selftest"))`, and `argv` is process-global. So
// `node items.js --selftest` imported auth.js, auth.js saw the flag, ran ITS
// tests and called process.exit(0) — the run printed "auth selftest ok" and
// exited green without ever executing a single items.js assertion. A test suite
// that passes by not running is the worst possible failure mode, and it looked
// exactly like success.
import { pathToFileURL } from "node:url";

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return metaUrl === pathToFileURL(process.argv[1]).href;
  } catch (_) {
    return false;
  }
}
