import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  requireRelativeMarkdownFile,
  requireRelativeSourceFile,
  resolveContainedSourcePath,
} from "./lib/artifact-path.js";

export const MAX_MARKDOWN_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_ASSET_BYTES = 8 * 1024 * 1024;

const sourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("thread-workspace"),
      threadId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("thread-storage"),
      threadId: z.string().trim().min(1),
    })
    .strict(),
]);

export type TypstMdSource = z.infer<typeof sourceSchema>;

interface SourceRoot {
  hostId: string;
  rootPath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const status = error.status;
  return typeof status === "number" ? status : null;
}

async function resolveThreadWorkspace(
  bb: BbPluginApi,
  threadId: string,
): Promise<SourceRoot> {
  const thread = await bb.sdk.threads.get({
    threadId,
    include: "environment",
  });
  if (!("environment" in thread)) {
    throw new Error(
      "Thread environment was not returned - typst-md needs a live environment.",
    );
  }
  const environment = thread.environment;
  const workspacePath =
    typeof environment?.path === "string" ? environment.path : null;
  if (!environment || !workspacePath) {
    throw new Error(
      "This thread has no workspace path - typst-md needs a live environment.",
    );
  }
  const hostId =
    typeof environment?.hostId === "string" ? environment.hostId : null;
  if (!hostId) {
    throw new Error(
      "This thread's environment has no hostId - cannot read workspace files.",
    );
  }
  return { hostId, rootPath: workspacePath };
}

async function resolveSourceRoot(
  bb: BbPluginApi,
  source: TypstMdSource,
): Promise<SourceRoot> {
  if (source.kind === "thread-storage") {
    const storage = await bb.sdk.threads.storageLocation({
      threadId: source.threadId,
    });
    return { hostId: storage.hostId, rootPath: storage.storageRootPath };
  }
  return await resolveThreadWorkspace(bb, source.threadId);
}

async function readSourceFile(
  bb: BbPluginApi,
  args: {
    file: string;
    hostId: string;
    label: string;
    maxBytes: number;
    rootPath: string;
  },
) {
  let result;
  try {
    result = await bb.sdk.files.read({
      path: resolveContainedSourcePath(args.rootPath, args.file),
      rootPath: args.rootPath,
      hostId: args.hostId,
    });
  } catch (error) {
    if (httpStatus(error) === 404) {
      throw new Error(`${args.label} not found: ${args.file}`);
    }
    throw error;
  }
  if (result.sizeBytes > args.maxBytes) {
    throw new Error(
      `${args.label} is too large (${result.sizeBytes} bytes; max ${args.maxBytes}).`,
    );
  }
  return result;
}

export const typstMdRpcContract = defineRpcContract({
  prepareDocument: {
    input: z
      .object({
        source: sourceSchema,
        file: z.string().transform((value) => requireRelativeMarkdownFile(value)),
      })
      .strict(),
    output: z
      .object({
        file: z.string(),
        content: z.string(),
      })
      .strict(),
  },
  readAsset: {
    input: z
      .object({
        source: sourceSchema,
        file: z.string().transform((value) => requireRelativeSourceFile(value)),
      })
      .strict(),
    output: z
      .object({
        file: z.string(),
        content: z.string(),
        contentEncoding: z.enum(["base64", "utf8"]),
      })
      .strict(),
  },
});

export default async function plugin(bb: BbPluginApi) {
  bb.rpc.register(typstMdRpcContract, {
    async prepareDocument({ source, file }) {
      const root = await resolveSourceRoot(bb, source);
      const result = await readSourceFile(bb, {
        file,
        hostId: root.hostId,
        label: "Markdown file",
        maxBytes: MAX_MARKDOWN_SOURCE_BYTES,
        rootPath: root.rootPath,
      });
      if (result.contentEncoding !== "utf8") {
        throw new Error(
          `Markdown file is not valid UTF-8 text (encoding=${result.contentEncoding}).`,
        );
      }
      return { file, content: result.content };
    },

    async readAsset({ source, file }) {
      const root = await resolveSourceRoot(bb, source);
      const result = await readSourceFile(bb, {
        file,
        hostId: root.hostId,
        label: "Markdown asset",
        maxBytes: MAX_ASSET_BYTES,
        rootPath: root.rootPath,
      });
      return {
        file,
        content: result.content,
        contentEncoding:
          result.contentEncoding === "utf8"
            ? ("utf8" as const)
            : ("base64" as const),
      };
    },
  });
}
