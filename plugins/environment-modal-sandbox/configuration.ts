export const SETTING_DESCRIPTORS = {
  tokenId: {
    type: "string",
    secret: true,
    label: "Modal token id",
    description:
      "The token id half of a Modal API token (modal token new writes one to ~/.modal.toml).",
  },
  tokenSecret: {
    type: "string",
    label: "Modal token secret",
    secret: true,
    description: "The token secret half of the same Modal API token.",
  },
  appName: {
    type: "string",
    label: "Modal app name",
    description: "The Modal app the sandboxes are created in.",
    default: "bb-sandboxes",
  },
  idleMinutes: {
    type: "number",
    label: "Hibernate after idle (minutes)",
    description:
      "Snapshot and stop an idle sandbox after this long. Use 0 to keep it running until Modal's 24-hour sandbox limit.",
    default: 15,
  },
} as const;

export interface ResolvedSettings {
  tokenId: string;
  tokenSecret: string;
  appName: string;
  idleMs: number | null;
}

export type SettingsResolution =
  | { ok: true; settings: ResolvedSettings }
  | { ok: false; message: string };

export interface RawSettings {
  tokenId: string | undefined;
  tokenSecret: string | undefined;
  appName: string;
  idleMinutes: number;
}

export const SANDBOX_LIFETIME_MS = 24 * 60 * 60_000;
const MAX_IDLE_MINUTES = 24 * 60;

export function resolveSettings(raw: RawSettings): SettingsResolution {
  const tokenId = (raw.tokenId ?? "").trim();
  const tokenSecret = (raw.tokenSecret ?? "").trim();
  const missing: string[] = [];
  if (tokenId.length === 0) missing.push("tokenId");
  if (tokenSecret.length === 0) missing.push("tokenSecret");
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Set ${missing.join(" and ")} in the plugin's settings.`,
    };
  }
  const appName = raw.appName.trim();
  if (appName.length === 0) {
    return { ok: false, message: "The app name must not be blank." };
  }
  if (
    !Number.isInteger(raw.idleMinutes) ||
    raw.idleMinutes < 0 ||
    raw.idleMinutes > MAX_IDLE_MINUTES
  ) {
    return {
      ok: false,
      message: `idleMinutes must be a whole number between 0 and ${MAX_IDLE_MINUTES}, not ${raw.idleMinutes}.`,
    };
  }
  return {
    ok: true,
    settings: {
      tokenId,
      tokenSecret,
      appName,
      idleMs: raw.idleMinutes === 0 ? null : raw.idleMinutes * 60_000,
    },
  };
}
