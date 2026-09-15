import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  requireRelativeSourceFile,
  requireRelativeTypstFile,
  resolveContainedSourcePath,
} from "./lib/artifact-path.js";

export const MAX_TYPST_SOURCE_BYTES = 5 * 1024 * 1024;
export const MAX_TYPST_DEPENDENCY_BYTES = 8 * 1024 * 1024;

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
  z
    .object({
      kind: z.literal("workspace"),
      environmentId: z.string().nullable(),
      projectId: z.string().nullable(),
      hostId: z.string().nullable(),
    })
    .strict(),
]);

export type TypstArtifactSource = z.infer<typeof sourceSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const status = error.status;
  return typeof status === "number" ? status : null;
}

interface SourceRoot {
  hostId: string;
  rootPath: string;
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
      "Thread environment was not returned - typst-inline needs a live environment.",
    );
  }
  const environment = thread.environment;
  const workspacePath =
    typeof environment?.path === "string" ? environment.path : null;
  if (!environment || !workspacePath) {
    throw new Error(
      "This thread has no workspace path - typst-inline needs a live environment.",
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

async function resolveWorkspace(
  bb: BbPluginApi,
  source: Extract<TypstArtifactSource, { kind: "workspace" }>,
): Promise<SourceRoot> {
  if (source.environmentId !== null) {
    const environment = await bb.sdk.environments.get({
      environmentId: source.environmentId,
    });
    const rootPath =
      typeof environment?.path === "string" ? environment.path : null;
    const hostId =
      typeof environment?.hostId === "string" ? environment.hostId : null;
    if (!environment || !rootPath) {
      throw new Error("This environment has no workspace path.");
    }
    if (!hostId) throw new Error("This environment has no hostId.");
    return { hostId, rootPath };
  }
  if (source.projectId !== null) {
    const project = await bb.sdk.projects.get({ projectId: source.projectId });
    const checkouts = project.sources;
    const checkout =
      source.hostId === null
        ? (checkouts.find((entry) => entry.isDefault) ?? checkouts[0])
        : checkouts.find((entry) => entry.hostId === source.hostId);
    if (checkout === undefined) {
      throw new Error("This project has no matching source checkout.");
    }
    return { hostId: checkout.hostId, rootPath: checkout.path };
  }
  throw new Error(
    "This file has no environment or project to resolve it against.",
  );
}

async function resolveSourceRoot(
  bb: BbPluginApi,
  source: TypstArtifactSource,
): Promise<SourceRoot> {
  if (source.kind === "thread-workspace") {
    return await resolveThreadWorkspace(bb, source.threadId);
  }
  if (source.kind === "thread-storage") {
    const storage = await bb.sdk.threads.storageLocation({
      threadId: source.threadId,
    });
    return { hostId: storage.hostId, rootPath: storage.storageRootPath };
  }
  return await resolveWorkspace(bb, source);
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

export const typstInlineRpcContract = defineRpcContract({
  prepareArtifact: {
    input: z
      .object({
        source: sourceSchema,
        file: z.string().transform((value) => requireRelativeTypstFile(value)),
      })
      .strict(),
    output: z
      .object({
        file: z.string(),
        content: z.string(),
      })
      .strict(),
  },
  readArtifactFile: {
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
  bb.rpc.register(typstInlineRpcContract, {
    async prepareArtifact({ source, file }) {
      const root = await resolveSourceRoot(bb, source);
      const result = await readSourceFile(bb, {
        file,
        hostId: root.hostId,
        label: "Typst file",
        maxBytes: MAX_TYPST_SOURCE_BYTES,
        rootPath: root.rootPath,
      });
      if (result.contentEncoding !== "utf8") {
        throw new Error(
          `Typst file is not valid UTF-8 text (encoding=${result.contentEncoding}).`,
        );
      }
      return { file, content: result.content };
    },

    async readArtifactFile({ source, file }) {
      const root = await resolveSourceRoot(bb, source);
      const result = await readSourceFile(bb, {
        file,
        hostId: root.hostId,
        label: "Typst dependency",
        maxBytes: MAX_TYPST_DEPENDENCY_BYTES,
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
