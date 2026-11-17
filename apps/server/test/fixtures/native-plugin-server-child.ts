import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";
import { z } from "zod";
import { upsertInstalledPlugin } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { createPluginService } from "../../src/services/plugins/plugin-service.js";
import { createAiServiceRegistry } from "../../src/services/ai/ai-service-registry.js";
import { createNoopTelemetryService } from "../../src/services/system/telemetry.js";
import {
  nativePluginRequestSchema,
  nativePluginResultSchema,
  type NativePluginRequest,
  type NativePluginResult,
} from "./native-plugin-server-protocol.js";

declare global {
  var __nativeExternalTypes: unknown;
  var __nativeSourceResult: unknown;
  var __readImportedPlugin: unknown;
}

async function execute(
  request: NativePluginRequest,
): Promise<NativePluginResult> {
  const db = createMigratedConnection();
  try {
    const service = createPluginService({
      aiServices: createAiServiceRegistry(),
      telemetry: createNoopTelemetryService(),
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginChanged: () => {},
        onWatchedTargets: () => () => {},
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger: pino({ enabled: false }),
      dataDir: request.dataDir,
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
    });
    try {
      if (request.kind === "prebuilt") {
        upsertInstalledPlugin(db, {
          id: "native-externals",
          source: "git:github.com/acme/bb-plugin-native-externals@v1",
          rootDir: request.rootDir,
          version: "0.1.0",
          enabled: true,
          enabledFollowsDefault: false,
          provenance: { kind: "direct" },
          sourceIntent: {
            kind: "git",
            url: "https://github.com/acme/bb-plugin-native-externals",
            subdirectory: null,
            selector: { kind: "ref", ref: "v1", refKind: "branch" },
          },
          exactResolution: { kind: "git", commit: "test-commit" },
          updateState: {
            lastCheckAt: null,
            availableCompatibleVersion: null,
            newestIncompatibleVersion: null,
            statusDetail: null,
          },
          activeArtifactId: null,
        });
        await service.reload("native-externals");
        const entry = service
          .list()
          .find((plugin) => plugin.id === "native-externals");
        if (entry === undefined)
          throw new Error("Native external plugin is missing");
        return {
          status: entry.status,
          statusDetail: entry.statusDetail,
          types: z
            .tuple([z.string(), z.string()])
            .parse(globalThis.__nativeExternalTypes),
        };
      }
      if (request.kind === "source") {
        const entry = await service.installPath(request.rootDir);
        return {
          status: entry.status,
          statusDetail: entry.statusDetail,
          value: z
            .tuple([z.string(), z.string()])
            .parse(globalThis.__nativeSourceResult),
        };
      }
      await service.installPath(request.importedDir);
      await service.installPath(request.importerDir);
      const read = globalThis.__readImportedPlugin;
      if (typeof read !== "function")
        throw new Error("Native importer did not register its reader");
      const before = z.string().parse(await read());
      await writeFile(
        join(request.importedDir, "shared.js"),
        'export const value = "after";\n',
      );
      await service.reload("imported");
      const after = z.string().parse(await read());
      return { before, after };
    } finally {
      await service.stop();
    }
  } finally {
    db.$client.close();
    Reflect.deleteProperty(globalThis, "__nativeExternalTypes");
    Reflect.deleteProperty(globalThis, "__nativeSourceResult");
    Reflect.deleteProperty(globalThis, "__readImportedPlugin");
  }
}

process.on("disconnect", () => process.exit(0));
async function handleMessage(message: unknown): Promise<void> {
  try {
    const request = nativePluginRequestSchema.parse(message);
    const result = nativePluginResultSchema.parse(await execute(request));
    process.send?.({ kind: "result", result });
  } catch (error) {
    process.send?.({
      kind: "error",
      message:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}
process.on("message", (message: unknown) => {
  void handleMessage(message);
});
process.send?.({ kind: "ready" });
