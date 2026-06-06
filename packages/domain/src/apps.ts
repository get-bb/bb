import { z } from "zod";

export const APPLICATION_ID_MAX_LENGTH = 64;
const APPLICATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const APPLICATION_NAME_SLUG_SEGMENT_PATTERN = /[a-z0-9]+/gu;
const APP_DATA_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,80}$/u;
const APP_DATA_PATH_MAX_DEPTH = 8;
// Keep these app-data path limits in sync with the injected app client
// validator in apps/server/src/services/threads/app-client-script.ts.
const APP_DATA_PATH_MAX_LENGTH = 512;

export const applicationIdSchema = z
  .string()
  .min(1)
  .max(APPLICATION_ID_MAX_LENGTH)
  .regex(
    APPLICATION_ID_PATTERN,
    "Application id must be a lowercase slug containing only letters, numbers, and hyphens",
  );
export type ApplicationId = z.infer<typeof applicationIdSchema>;

/**
 * App sources are named with the same slug rules as application ids; the name
 * doubles as the source's directory name under the app-sources root.
 */
export const appSourceNameSchema = z
  .string()
  .min(1)
  .max(APPLICATION_ID_MAX_LENGTH)
  .regex(
    APPLICATION_ID_PATTERN,
    "App source name must be a lowercase slug containing only letters, numbers, and hyphens",
  );
export type AppSourceName = z.infer<typeof appSourceNameSchema>;

export function deriveAppSourceNameFromOrigin(origin: string): AppSourceName {
  const trimmed = origin.replace(/\/+$/u, "").replace(/\.git$/u, "");
  const lastSegment = trimmed.split(/[/:\\]/u).at(-1) ?? "";
  const segments = lastSegment
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/gu, "")
    .match(APPLICATION_NAME_SLUG_SEGMENT_PATTERN);
  const slug = (segments ?? [])
    .join("-")
    .slice(0, APPLICATION_ID_MAX_LENGTH)
    .replace(/-+$/u, "");
  return appSourceNameSchema.parse(slug);
}

export function deriveApplicationIdFromName(name: string): ApplicationId {
  const normalizedName = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/gu, "");
  const segments = normalizedName.match(APPLICATION_NAME_SLUG_SEGMENT_PATTERN);
  const slug = (segments ?? [])
    .join("-")
    .slice(0, APPLICATION_ID_MAX_LENGTH)
    .replace(/-+$/u, "");
  return applicationIdSchema.parse(slug);
}

export const appDataPathSchema = z.string().superRefine((value, context) => {
  if (
    value.length === 0 ||
    value.length > APP_DATA_PATH_MAX_LENGTH ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/")
  ) {
    context.addIssue({
      code: "custom",
      message: "Invalid app data path",
    });
    return;
  }

  const segments = value.split("/");
  if (segments.length > APP_DATA_PATH_MAX_DEPTH) {
    context.addIssue({
      code: "custom",
      message: "App data path is too deep",
    });
    return;
  }

  for (const segment of segments) {
    if (
      segment === "." ||
      segment === ".." ||
      segment.startsWith(".") ||
      !APP_DATA_PATH_SEGMENT_PATTERN.test(segment)
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid app data path segment",
      });
      return;
    }
  }
});
export type AppDataPath = z.infer<typeof appDataPathSchema>;
