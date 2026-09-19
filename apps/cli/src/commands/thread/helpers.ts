import { readFile } from "node:fs/promises";
import { basename, isAbsolute, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBuiltinPlanCommandTextInput,
  permissionModeInputSchema,
  type PermissionMode,
  type PromptInput,
  serviceTierSchema,
  type ServiceTier,
  threadLifecycleSchema,
  type ThreadLifecycle,
} from "@bb/domain";
import {
  DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  DEFAULT_THREAD_WAIT_TIMEOUT_MS,
} from "@bb/sdk";
import type { BbSdk } from "@bb/sdk/node";
import { parseDurationMs } from "../../duration.js";
import { joinValues } from "../helpers.js";

export const THREAD_WAIT_EXIT_CODE_TIMEOUT = 2;
export const THREAD_WAIT_EXIT_CODE_INVALID_REQUEST = 3;
export const THREAD_WAIT_EXIT_CODE_UNREACHABLE = 4;
export const DEFAULT_THREAD_WAIT_TIMEOUT_SECONDS =
  DEFAULT_THREAD_WAIT_TIMEOUT_MS / 1000;

const SERVICE_TIERS: ServiceTier[] = ["fast", "default"];
export const PERMISSION_MODE_HELP =
  "Permission mode: accept-edits, auto, or full";
export const PLAN_HELP =
  "Send the message as the provider's /plan action so the agent proposes a plan for approval before executing";

export function parseThreadLifecycles(
  value: string | undefined,
): ThreadLifecycle[] | undefined {
  if (value === undefined) return undefined;
  return [
    ...new Set(
      value.split(",").map((entry) => {
        const result = threadLifecycleSchema.safeParse(entry.trim());
        if (!result.success) {
          throw new Error(
            "--lifecycle must contain active, draft, or archived, separated by commas.",
          );
        }
        return result.data;
      }),
    ),
  ];
}

export function buildPromptInputs(args: {
  message: string;
  files?: readonly string[];
  images?: readonly string[];
  plan?: boolean;
}): PromptInput[] {
  return [
    args.plan
      ? createBuiltinPlanCommandTextInput(args.message)
      : { type: "text", text: args.message, mentions: [] },
    ...(args.files ?? []).map((path): PromptInput => ({
      type: "localFile",
      path,
    })),
    ...(args.images ?? []).map((path): PromptInput => ({
      type: "localImage",
      path,
    })),
  ];
}

function resolveClientAttachmentPath(pathOrToken: string): string | null {
  if (isAbsolute(pathOrToken) || win32.isAbsolute(pathOrToken)) {
    return pathOrToken;
  }
  if (!pathOrToken.toLowerCase().startsWith("file:")) {
    return null;
  }
  try {
    return fileURLToPath(pathOrToken);
  } catch {
    throw new Error(`Invalid client attachment URL '${pathOrToken}'.`);
  }
}

function clientAttachmentFilename(clientPath: string): string {
  const filename = win32.isAbsolute(clientPath)
    ? win32.basename(clientPath)
    : basename(clientPath);
  if (filename.length === 0) {
    throw new Error(`Attachment path '${clientPath}' has no filename.`);
  }
  return filename;
}

function inferPngMimeType(bytes: Uint8Array): "image/png" | undefined {
  return bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
    ? "image/png"
    : undefined;
}

async function clientAttachmentMimeType(
  clientPath: string,
  bytes: Uint8Array,
): Promise<string> {
  const { default: mimeTypes } = await import("mime-types");
  const inferred = mimeTypes.lookup(clientPath);
  return typeof inferred === "string"
    ? inferred
    : (inferPngMimeType(bytes) ?? "application/octet-stream");
}

export async function uploadClientAttachmentInputs(args: {
  input: PromptInput[];
  resolveProjectId: () => Promise<string>;
  sdk: BbSdk;
}): Promise<PromptInput[]> {
  const clientPaths = args.input.map((item) =>
    item.type === "localImage" || item.type === "localFile"
      ? resolveClientAttachmentPath(item.path)
      : null,
  );
  if (clientPaths.every((path) => path === null)) {
    return args.input;
  }

  const projectId = await args.resolveProjectId();
  const uploadedPathByClientPath = new Map<string, Promise<string>>();
  const upload = (clientPath: string): Promise<string> => {
    const existing = uploadedPathByClientPath.get(clientPath);
    if (existing) return existing;
    const pending = (async () => {
      const bytes = await readFile(clientPath);
      const filename = clientAttachmentFilename(clientPath);
      const uploaded = await args.sdk.projects.attachments.upload({
        clientFile: bytes,
        filename,
        mimeType: await clientAttachmentMimeType(clientPath, bytes),
        projectId,
      });
      return uploaded.path;
    })();
    uploadedPathByClientPath.set(clientPath, pending);
    return pending;
  };

  return Promise.all(
    args.input.map(async (item, index) => {
      const clientPath = clientPaths[index];
      return (item.type === "localImage" || item.type === "localFile") &&
        clientPath
        ? { ...item, path: await upload(clientPath) }
        : item;
    }),
  );
}

export function parseThreadWaitTimeoutMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_THREAD_WAIT_TIMEOUT_MS;
  return parseDurationMs({
    allowZero: true,
    defaultUnit: "s",
    label: "--timeout",
    value,
  });
}

export function parseThreadWaitPollIntervalMs(
  value: string | undefined,
): number {
  if (value === undefined) return DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS;
  return parseDurationMs({
    allowZero: false,
    defaultUnit: "ms",
    label: "--poll-interval",
    value,
  });
}

export function parseServiceTier(
  value: string | undefined,
): ServiceTier | undefined {
  if (value === undefined) return undefined;
  const parsed = serviceTierSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `Invalid service tier '${value}'. Expected ${joinValues(SERVICE_TIERS)}.`,
  );
}

export function parsePermissionMode(
  value: string | undefined,
): PermissionMode | undefined {
  if (value === undefined) return undefined;
  const parsed = permissionModeInputSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `Invalid permission mode '${value}'. Expected accept-edits, auto, or full.`,
  );
}
