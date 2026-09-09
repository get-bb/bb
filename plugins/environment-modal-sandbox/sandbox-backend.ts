import { createHash } from "node:crypto";
import { z } from "zod";
import {
  ensureStandardImage,
  type StandardImageRequest,
} from "./standard-image.js";
import { ModalClient, NotFoundError, type Sandbox } from "modal";

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxHandle {
  readonly sandboxId: string;
  exec(
    command: readonly string[],
    options: {
      timeoutMs: number;
      signal: AbortSignal;
      stdin?: string;
      maxOutputBytes?: number;
    },
  ): Promise<SandboxExecResult>;
  terminate(): Promise<void>;
  snapshotFilesystem(options: {
    timeoutMs: number;
    ttlMs: number | null;
  }): Promise<string>;
}

export function createSandboxExecutor(sandbox: SandboxHandle) {
  return {
    exec: ({
      command,
      ...options
    }: Parameters<SandboxHandle["exec"]>[1] & {
      command: string[];
    }) => sandbox.exec(command, options),
  };
}

export type SandboxImage =
  | { type: "snapshot"; imageId: string }
  | { type: "image"; imageId: string };

export interface SandboxCreateRequest {
  appName: string;
  name: string;
  image: SandboxImage;
  environmentVariables: Readonly<Record<string, string>>;
  timeoutMs: number;
  cpu: number | null;
  memoryMiB: number | null;
  tags: Record<string, string>;
}

export interface SandboxBackend {
  accountIdentity(): Promise<string>;
  ensureStandardImage(request: StandardImageRequest): Promise<string>;
  close(): void;
  observe(request: {
    sandboxId: string;
    appName: string;
    key: string;
  }): Promise<{ running: boolean; expiresAt: number | null }>;
  create(request: SandboxCreateRequest): Promise<SandboxHandle>;
  deleteSnapshot(imageId: string): Promise<void>;
  fromId(sandboxId: string): Promise<SandboxHandle | null>;
  fromName(appName: string, name: string): Promise<SandboxHandle | null>;
}

export interface ModalCredentials {
  tokenId: string;
  tokenSecret: string;
}

export type SandboxBackendFactory = (
  credentials: ModalCredentials,
) => SandboxBackend;

async function boundedOutput(stream: AsyncIterable<string>, maxBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    const data = Buffer.from(chunk);
    const remaining = maxBytes - size;
    if (data.length > remaining) truncated = true;
    if (remaining > 0) {
      const kept = data.subarray(0, remaining);
      chunks.push(kept);
      size += kept.length;
    }
  }
  return (
    Buffer.concat(chunks).toString("utf8") +
    (truncated ? "\n[output truncated]" : "")
  );
}

function wrapSandbox(sandbox: Sandbox): SandboxHandle {
  return {
    sandboxId: sandbox.sandboxId,
    async exec(command, options) {
      options.signal.throwIfAborted();
      let onAbort: () => void = () => {};
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(options.signal.reason);
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        return await Promise.race([
          aborted,
          (async () => {
            const process = await sandbox.exec([...command], {
              mode: "text",
              stdout: "pipe",
              stderr: "pipe",
              timeoutMs: Math.max(
                1000,
                Math.floor(options.timeoutMs / 1000) * 1000,
              ),
            });
            const input = async () => {
              try {
                options.signal.throwIfAborted();
                if (options.stdin !== undefined) {
                  await process.stdin.writeText(options.stdin);
                }
              } finally {
                await process.stdin.close();
              }
            };
            const [stdout, stderr, exitCode] = await Promise.all([
              options.maxOutputBytes === undefined
                ? process.stdout.readText()
                : boundedOutput(process.stdout, options.maxOutputBytes),
              options.maxOutputBytes === undefined
                ? process.stderr.readText()
                : boundedOutput(process.stderr, options.maxOutputBytes),
              process.wait(),
              input(),
            ]);
            return { exitCode, stdout, stderr };
          })(),
        ]);
      } finally {
        options.signal.removeEventListener("abort", onAbort);
      }
    },
    async terminate() {
      await sandbox.terminate();
    },
    async snapshotFilesystem(options) {
      const image = await sandbox.snapshotFilesystem({
        ...options,
        timeoutMs: Math.max(1000, Math.floor(options.timeoutMs / 1000) * 1000),
      });
      return image.imageId;
    },
  };
}

export const createModalBackend: SandboxBackendFactory = (credentials) => {
  const client = new ModalClient({
    tokenId: credentials.tokenId,
    tokenSecret: credentials.tokenSecret,
  });
  return {
    close: () => client.close(),
    ensureStandardImage: (request) => ensureStandardImage(credentials, request),
    async accountIdentity() {
      const identity = z
        .object({ workspaceId: z.string().min(1) })
        .parse(await client.cpClient.tokenInfoGet({}));
      return createHash("sha256").update(identity.workspaceId).digest("hex");
    },
    async observe(request) {
      const app = await client.apps.fromName(request.appName);
      const result = await client.cpClient.sandboxList({
        appId: app.appId,
        beforeTimestamp: 0,
        environmentName: client.environmentName(),
        includeFinished: false,
        tags: [{ tagName: "bbMachineKey", tagValue: request.key }],
      });
      const sandbox = result.sandboxes.find(
        (candidate) => candidate.id === request.sandboxId,
      );
      if (sandbox === undefined) return { running: false, expiresAt: null };
      const expiresAt = Math.floor(
        (sandbox.createdAt + sandbox.timeoutSecs) * 1000,
      );
      if (!Number.isFinite(expiresAt) || sandbox.timeoutSecs <= 0)
        throw new Error("Modal did not report a finite sandbox deadline");
      return { running: true, expiresAt };
    },
    async create(request) {
      const app = await client.apps.fromName(request.appName, {
        createIfMissing: true,
      });
      const image = await client.images.fromId(request.image.imageId);
      const sandbox = await client.sandboxes.create(app, image, {
        name: request.name,
        timeoutMs: request.timeoutMs,
        tags: request.tags,
        env: { ...request.environmentVariables },
        ...(request.cpu === null ? {} : { cpu: request.cpu }),
        ...(request.memoryMiB === null ? {} : { memoryMiB: request.memoryMiB }),
      });
      return wrapSandbox(sandbox);
    },
    async deleteSnapshot(imageId) {
      try {
        await client.images.delete(imageId);
      } catch (error) {
        if (error instanceof NotFoundError) return;
        throw error;
      }
    },
    async fromId(sandboxId) {
      try {
        const sandbox = await client.sandboxes.fromId(sandboxId);
        return (await sandbox.poll()) === null ? wrapSandbox(sandbox) : null;
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },
    async fromName(appName, name) {
      try {
        return wrapSandbox(await client.sandboxes.fromName(appName, name));
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },
  };
};
