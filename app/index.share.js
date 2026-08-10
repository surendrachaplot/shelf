// The share extension's entry point. expo-share-extension looks for exactly
// this filename and this component name — renaming either builds a target that
// launches to a blank sheet.
import { AppRegistry } from "react-native";
import ShareExtension from "./ShareExtension";

AppRegistry.registerComponent("shareExtension", () => ShareExtension);
