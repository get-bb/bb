import { parseApplicationUrl } from "@bb/domain/application-url";
import { Linking } from "react-native";

export async function openApplicationUrl(value: unknown): Promise<void> {
  const target = parseApplicationUrl(value);
  if (target === null)
    throw new Error("This application link is blocked or invalid.");
  await Linking.openURL(target.url);
}
