import Constants from "expo-constants";
import { Platform } from "react-native";
import { sliceUtf16Head } from "@bb/text-utils";

export function describeThisDevice(): string {
  const name = Constants.deviceName?.trim();
  if (name && name.length > 0) return sliceUtf16Head(name, 128);
  return Platform.OS === "android" ? "Android device" : "iPhone";
}
