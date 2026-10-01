// saveFile.ts — hand a file to the person, on whatever they are holding.
//
// Three platforms, three honest answers, and NO NEW NATIVE MODULE: a module
// the installed binary lacks reverts the whole app (see native.ts), and an
// export that only works after a new build is an export nobody has.
//
//   web      → a download. Blob + a link, the way a browser saves anything.
//   iOS      → the system share sheet on a file in the cache ("Save to Files",
//              AirDrop, Mail). React Native's own Share takes a file URL here.
//   Android  → RN's Share cannot carry a file there, so ask where to put it
//              (Storage Access Framework, part of expo-file-system, which every
//              binary already has) and write it.
//
// Returns false when the person backed out. Throws when it actually failed —
// "you cancelled" and "it broke" must not look the same.
import { Platform, Share } from "react-native";
import * as FileSystem from "expo-file-system";

export async function saveFile(name: string, mime: string, text: string): Promise<boolean> {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  if (Platform.OS === "android") {
    const SAF = FileSystem.StorageAccessFramework;
    const grant = await SAF.requestDirectoryPermissionsAsync();
    if (!grant.granted) return false;
    const uri = await SAF.createFileAsync(grant.directoryUri, name, mime);
    await FileSystem.writeAsStringAsync(uri, text);
    return true;
  }

  const uri = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory) + name;
  await FileSystem.writeAsStringAsync(uri, text);
  const r = await Share.share({ url: uri });
  return r.action !== Share.dismissedAction;
}
