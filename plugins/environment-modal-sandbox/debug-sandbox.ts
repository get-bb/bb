import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ResolvedSettings } from "./configuration.js";
import type { ImageDefinition } from "./image-definition.js";
import type { SandboxBackend } from "./sandbox-backend.js";

const recordSchema = z.object({
  accountIdentity: z.string(),
  appName: z.string(),
  key: z.string(),
});
export const sandboxInput = z.object({ sandboxId: z.string().min(1) }).strict();
export const execInput = sandboxInput.extend({
  command: z.array(z.string().max(65_536)).min(1).max(128),
});
export const buildOutput = z.object({ imageId: z.string(), logs: z.string() });
export const runOutput = buildOutput.extend({
  sandboxId: z.string(),
  expiresAt: z.number(),
});
export const execOutput = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
});

export function debugSandbox(
  bb: BbPluginApi,
  image: ImageDefinition,
  resolve: () => Promise<{
    backend: SandboxBackend;
    settings: ResolvedSettings;
  }>,
) {
  async function buildWith(
    { backend, settings }: Awaited<ReturnType<typeof resolve>>,
    signal: AbortSignal,
  ) {
    let logs = "";
    const append = (line: string) => {
      logs = (logs + line + "\n").slice(-65_536);
    };
    try {
      const imageId = await backend.ensureStandardImage({
        appName: settings.appName,
        displayName: "Default",
        dockerfile: (await image.get()).dockerfile,
        signal,
        report: { step: append, log: append },
      });
      return { imageId, logs };
    } catch (error) {
      throw new Error(
        `${logs}${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  async function owned(sandboxId: string) {
    const stored = await bb.storage.kv.get<unknown>(`debug/${sandboxId}`);
    if (stored === undefined)
      throw new Error(
        "Unknown debug sandbox; use an ID returned by bb modal sandbox run",
      );
    const record = recordSchema.parse(stored);
    const { backend } = await resolve();
    if (record.accountIdentity !== (await backend.accountIdentity()))
      throw new Error(
        "Restore the Modal account that created this debug sandbox",
      );
    const observed = await backend.observe({
      sandboxId,
      appName: record.appName,
      key: record.key,
    });
    return observed.running ? backend.fromId(sandboxId) : null;
  }
  return {
    async build(signal = new AbortController().signal) {
      return buildWith(await resolve(), signal);
    },
    async run(signal = new AbortController().signal) {
      const resolved = await resolve();
      const { backend, settings } = resolved;
      const built = await buildWith(resolved, signal);
      const accountIdentity = await backend.accountIdentity();
      signal.throwIfAborted();
      const key = `bb-debug-${randomUUID()}`;
      const expiresAt = Date.now() + 30 * 60_000;
      const sandbox = await backend.create({
        appName: settings.appName,
        name: key,
        image: { type: "image", imageId: built.imageId },
        timeoutMs: 30 * 60_000,
        cpu: null,
        memoryMiB: null,
        tags: { bbDebug: "true", bbMachineKey: key },
      });
      try {
        signal.throwIfAborted();
        await bb.storage.kv.set(`debug/${sandbox.sandboxId}`, {
          accountIdentity,
          appName: settings.appName,
          key,
        });
        signal.throwIfAborted();
        return {
          ...built,
          sandboxId: sandbox.sandboxId,
          expiresAt,
        };
      } catch (error) {
        await sandbox.terminate();
        throw error;
      }
    },
    async exec(
      input: z.infer<typeof execInput>,
      signal = new AbortController().signal,
    ) {
      const sandbox = await owned(input.sandboxId);
      if (!sandbox)
        throw new Error(
          "Debug sandbox has stopped or expired; run a new sandbox",
        );
      return sandbox.exec(input.command, {
        timeoutMs: 60_000,
        signal,
        maxOutputBytes: 131_072,
      });
    },
    async stop({ sandboxId }: z.infer<typeof sandboxInput>) {
      const sandbox = await owned(sandboxId);
      await sandbox?.terminate();
      return { sandboxId };
    },
  };
}
export type DebugSandbox = ReturnType<typeof debugSandbox>;
