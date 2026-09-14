import type { PluginSettingDescriptors } from "@get-bb/plugin-sdk";
import {
  resolveSshSettings,
  type RawSshSettings,
  type ResolvedSshSettings,
} from "./target.js";

export const SETTING_DESCRIPTORS = {
  identityFile: {
    type: "string",
    label: "SSH identity file",
    description:
      "Optional private-key path on the bb server. Leave blank to use ssh-agent and default keys.",
    default: "",
  },
  knownHosts: {
    type: "select",
    label: "Host key checking",
    description:
      "accept-new records unknown sandbox host keys. yes requires a known_hosts entry. no disables checking.",
    options: ["accept-new", "yes", "no"],
    default: "accept-new",
  },
  connectTimeoutSeconds: {
    type: "number",
    label: "SSH connect timeout (seconds)",
    description: "How long to wait for the SSH handshake.",
    default: 15,
  },
} satisfies PluginSettingDescriptors;

export type { RawSshSettings, ResolvedSshSettings };

export function parseSettings(raw: RawSshSettings): ResolvedSshSettings {
  return resolveSshSettings(raw);
}
