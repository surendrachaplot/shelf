// withShareExtensionKeychain.js — let the share extension read the login.
//
// THE BUG THIS FIXES IS SILENT. `expo-share-extension` writes the extension's
// entitlements file itself, and it writes exactly two things: the app group,
// and Apple Sign In if you use it. It does NOT write `keychain-access-groups`,
// and it takes no option to add them — it overwrites the file on every
// prebuild.
//
// So the app stores its device token in the Keychain under
// `$(AppIdentifierPrefix)com.…shelf`, the extension has no access to that
// group, and every share fails with "not paired" — from a share sheet that
// cannot show you an error, over Instagram, where there is nothing to read a
// log from. That is the worst possible place for a silent failure, which is
// why the app has `verifySharedAccess()` and says so out loud at pairing time.
// But detecting it is not fixing it.
//
// This runs AFTER that plugin, reads the file it just wrote, and adds the
// group. It uses `withEntitlementsPlist` — the same mod key the share
// extension plugin uses — so the two are guaranteed to chain rather than race.
//
// IT MUST BE LISTED **BEFORE** `expo-share-extension` IN app.json.
//
// That is backwards from the obvious reading and it is not a guess: mods with
// the same key wrap each other, so the LAST plugin listed runs FIRST. Listed
// the intuitive way round, this ran before the file existed. The guard below
// caught it on the first `expo prebuild`, which is the only reason this
// comment is right rather than confidently wrong.
const { withEntitlementsPlist } = require("expo/config-plugins");
const plist = require("@expo/plist").default;
const fs = require("fs");
const path = require("path");

// Reached into rather than reimplemented: if the plugin ever changes how it
// names the target, this follows it instead of silently writing to a path
// nothing reads.
const { getShareExtensionName } = require("expo-share-extension/plugin/build/index");

const withShareExtensionKeychain = (config) => {
  return withEntitlementsPlist(config, (cfg) => {
    const groups = cfg.ios?.entitlements?.["keychain-access-groups"];
    if (!groups?.length) return cfg;   // nothing to share; leave it alone

    const targetName = getShareExtensionName(cfg);
    const file = path.join(cfg.modRequest.platformProjectRoot, targetName, `${targetName}.entitlements`);

    // If the share-extension plugin has not written it yet, this plugin is
    // listed in the wrong order. Fail loudly: a missing keychain group is
    // invisible until somebody shares a reel and nothing happens.
    if (!fs.existsSync(file)) {
      throw new Error(
        `[withShareExtensionKeychain] ${file} does not exist yet — list this plugin BEFORE "expo-share-extension" in app.json ` +
        `(mods with the same key run last-listed-first, so being listed first is what makes this run last)`
      );
    }

    const existing = plist.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, plist.build({ ...existing, "keychain-access-groups": groups }));
    return cfg;
  });
};

module.exports = withShareExtensionKeychain;
