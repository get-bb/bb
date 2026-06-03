import { z } from "zod";

const APPLICATION_ID_PATTERN = /^app_[A-Za-z0-9_-]{1,80}$/u;
const APP_DATA_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]{1,80}$/u;
const APP_DATA_PATH_MAX_DEPTH = 8;
// Keep these app-data path limits in sync with the injected app client
// validator in apps/server/src/services/threads/app-client-script.ts.
const APP_DATA_PATH_MAX_LENGTH = 512;

export const applicationIdSchema = z.string().regex(APPLICATION_ID_PATTERN);
export type ApplicationId = z.infer<typeof applicationIdSchema>;

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
