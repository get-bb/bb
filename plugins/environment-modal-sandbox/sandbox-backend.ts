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
    options: { timeoutMs: number; signal: AbortSignal; stdin?: string },
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
  | { type: "registry"; reference: string }
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
              timeoutMs: options.timeoutMs,
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
              process.stdout.readText(),
              process.stderr.readText(),
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
      const image = await sandbox.snapshotFilesystem(options);
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
    async create(request) {
      const app = await client.apps.fromName(request.appName, {
        createIfMissing: true,
      });
      const image =
        request.image.type === "registry"
          ? client.images.fromRegistry(request.image.reference)
          : await client.images.fromId(request.image.imageId);
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
