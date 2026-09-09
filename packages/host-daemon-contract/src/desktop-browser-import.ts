import { z } from "zod";

export const DESKTOP_BROWSER_IMPORT_SOURCE_IDS = [
  "chrome",
  "chromium",
  "edge",
  "brave",
  "vivaldi",
  "opera",
  "arc",
  "firefox",
  "safari",
] as const;
export const desktopBrowserImportSourceIdSchema = z.enum(
  DESKTOP_BROWSER_IMPORT_SOURCE_IDS,
);
export type DesktopBrowserImportSourceId = z.infer<
  typeof desktopBrowserImportSourceIdSchema
>;

export const desktopBrowserImportUnavailableReasonSchema = z.enum([
  "notInstalled",
  "needsKeychainApproval",
  "keychainItemMissing",
  "needsFullDiskAccess",
  "browserRunning",
  "unsupportedPlatform",
]);
export type DesktopBrowserImportUnavailableReason = z.infer<
  typeof desktopBrowserImportUnavailableReasonSchema
>;

export const desktopBrowserImportFailureReasonSchema = z.enum([
  ...desktopBrowserImportUnavailableReasonSchema.options,
  "keychainUnavailable",
  "unknownSource",
  "unknownSourceProfile",
  "readFailed",
]);
export type DesktopBrowserImportFailureReason = z.infer<
  typeof desktopBrowserImportFailureReasonSchema
>;

const profileDirectory = z.string().min(1).max(4096);

export const desktopBrowserImportSourceProfileSchema = z
  .object({
    directory: profileDirectory,
    name: z.string().min(1).max(256),
    cookieCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DesktopBrowserImportSourceProfile = z.infer<
  typeof desktopBrowserImportSourceProfileSchema
>;

export const desktopBrowserImportSourceSchema = z
  .object({
    id: desktopBrowserImportSourceIdSchema,
    name: z.string().min(1).max(64),
    profiles: z.array(desktopBrowserImportSourceProfileSchema).max(100),
    unavailable: desktopBrowserImportUnavailableReasonSchema.optional(),
    icon: z
      .string()
      .max(256 * 1024)
      .regex(/^data:image\/[a-z+]+;base64,/u)
      .optional(),
  })
  .strict();
export type DesktopBrowserImportSource = z.infer<
  typeof desktopBrowserImportSourceSchema
>;

export const desktopBrowserImportSelectionSchema = z.object({
  sourceId: desktopBrowserImportSourceIdSchema,
  sourceProfileDirectory: profileDirectory,
});
export type DesktopBrowserImportSelection = z.infer<
  typeof desktopBrowserImportSelectionSchema
>;

export const desktopBrowserImportResultSchema = z
  .object({
    imported: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    skippedDomains: z.array(z.string().max(1024)).max(20),
  })
  .strict();
export type DesktopBrowserImportResult = z.infer<
  typeof desktopBrowserImportResultSchema
>;

export const desktopBrowserImportOutcomeSchema = z.discriminatedUnion("ok", [
  desktopBrowserImportResultSchema.extend({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      reason: desktopBrowserImportFailureReasonSchema,
    })
    .strict(),
]);
export type DesktopBrowserImportOutcome = z.infer<
  typeof desktopBrowserImportOutcomeSchema
>;

const UNAVAILABLE_COPY: Readonly<
  Record<DesktopBrowserImportUnavailableReason, string>
> = {
  notInstalled: "Not installed on this machine.",
  needsKeychainApproval:
    "Needs Keychain access to read its cookie encryption key. Approve the prompt and try again.",
  keychainItemMissing:
    "No encryption key found in your Keychain. Sign in to that browser once, then try again.",
  needsFullDiskAccess:
    "Give BB Full Disk Access in System Settings → Privacy & Security, then try again.",
  browserRunning: "Quit the browser first so its cookie database can be read.",
  unsupportedPlatform:
    "Importing from this browser isn't possible on this platform.",
};

export const DESKTOP_BROWSER_IMPORT_FAILURE_COPY: Readonly<
  Record<DesktopBrowserImportFailureReason, string>
> = {
  ...UNAVAILABLE_COPY,
  keychainUnavailable:
    "The system keyring could not be reached. Make sure it is running and unlocked, then try again.",
  unknownSource: "That browser is no longer available to import from.",
  unknownSourceProfile: "That browser profile no longer exists.",
  readFailed: "The browser's cookie database could not be read.",
};

export function isRetryableDesktopBrowserImportReason(
  reason: DesktopBrowserImportFailureReason,
): boolean {
  switch (reason) {
    case "needsKeychainApproval":
    case "keychainItemMissing":
    case "keychainUnavailable":
    case "readFailed":
    case "browserRunning":
    case "needsFullDiskAccess":
      return true;
    default:
      return false;
  }
}
