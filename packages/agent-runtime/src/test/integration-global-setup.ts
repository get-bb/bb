import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPluginHost, resolvePluginBuildToolchain } from "@bb/plugin-build";
import { ensurePluginProcessDataDir } from "@bb/process-utils";
import type { NormalizedPluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  captureFirstPartyProviderDeclarations,
  firstPartyPluginRootDir,
  type CaptureFirstPartyProviderDeclarationsOptions,
} from "./first-party-provider-declarations.js";
import {
  INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH,
  INTEGRATION_RAPP_MODEL_IDS,
  INTEGRATION_RAPP_MODEL_REQUEST_PATH,
  type IntegrationProviderBridgeManifest,
} from "./integration-provider-bridges.js";

const PROVIDER_BRIDGE_PLUGIN_IDS = [
  "provider-codex",
  "provider-claude-code",
  "provider-acp",
  "provider-pi",
  "provider-rapp",
] as const;

let rappBrainstemServer: Server | null = null;
let rappModelRequestCount = 0;

function sendJson(response: ServerResponse, value: unknown): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

async function handleRappBrainstemRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, { status: "ok", version: "integration", agents: [] });
    return;
  }
  if (request.method === "GET" && request.url === "/models") {
    rappModelRequestCount += 1;
    await writeFile(
      INTEGRATION_RAPP_MODEL_REQUEST_PATH,
      String(rappModelRequestCount),
    );
    sendJson(response, {
      current: INTEGRATION_RAPP_MODEL_IDS[0],
      models: [
        {
          id: INTEGRATION_RAPP_MODEL_IDS[0],
          name: "Claude Sonnet 5",
          available: true,
        },
        {
          id: INTEGRATION_RAPP_MODEL_IDS[1],
          name: "GPT-5.4",
          available: true,
        },
        {
          id: "unavailable-integration-model",
          name: "Unavailable",
          available: false,
        },
      ],
    });
    return;
  }
  response.statusCode = 404;
  response.end();
}

async function stopRappBrainstem(): Promise<void> {
  const server = rappBrainstemServer;
  rappBrainstemServer = null;
  if (server === null) {
    return;
  }
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolvePromise();
    });
  });
}

async function startRappBrainstem(): Promise<string> {
  await stopRappBrainstem();
  rappModelRequestCount = 0;
  await rm(INTEGRATION_RAPP_MODEL_REQUEST_PATH, { force: true });
  const server = createServer((request, response) => {
    void handleRappBrainstemRequest(request, response).catch((error) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  rappBrainstemServer = server;
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await stopRappBrainstem();
    throw new Error("RAPP integration Brainstem has no TCP address");
  }
  return `http://127.0.0.1:${address.port}/chat`;
}

function declarationSettings(
  pluginId: string,
  rappEndpoint: string,
): CaptureFirstPartyProviderDeclarationsOptions {
  return pluginId === "provider-rapp"
    ? { settings: { endpoint: rappEndpoint, grail: "consumer" } }
    : {};
}

function integrationProviderOptions(
  pluginId: string,
  declaration: NormalizedPluginProviderDeclaration,
): IntegrationProviderBridgeManifest[string]["providerOptions"] {
  const bridgeOptions = declaration.experimental_bridgeOptions ?? {};
  if (pluginId !== "provider-rapp") {
    return bridgeOptions;
  }
  const defaultModel = (declaration.models.fallback ?? []).find(
    (model) => model.isDefault,
  );
  if (defaultModel === undefined) {
    throw new Error(
      "provider-rapp integration declaration has no default model",
    );
  }
  return { ...bridgeOptions, model: defaultModel.id };
}

function wireCapabilities(
  declaration: NormalizedPluginProviderDeclaration,
): IntegrationProviderBridgeManifest[string]["capabilities"] {
  const { capabilities } = declaration;
  return {
    providerInstallation: declaration.maintenance?.installation ?? false,
    supportsServiceTier: capabilities.supportsServiceTier,
    permissionModes: [...capabilities.permissionModes],
    supportsThreadArchive: capabilities.supportsThreadArchive,
    supportsThreadRename: capabilities.supportsThreadRename,
    fork: capabilities.fork,
  };
}

export async function setup(): Promise<void> {
  const rappEndpoint = await startRappBrainstem();
  const bridgeDataRoot = join(tmpdir(), "bb-agent-runtime-integration-daemon");
  const toolchain = await resolvePluginBuildToolchain(
    join(tmpdir(), "bb-plugin-build-toolchain"),
  );
  const manifest: IntegrationProviderBridgeManifest = {};
  try {
    for (const pluginId of PROVIDER_BRIDGE_PLUGIN_IDS) {
      const rootDir = firstPartyPluginRootDir(pluginId);
      const [declarations, build] = await Promise.all([
        captureFirstPartyProviderDeclarations(
          pluginId,
          declarationSettings(pluginId, rappEndpoint),
        ),
        buildPluginHost(rootDir, "0.0.0-integration", toolchain),
      ]);
      const dataDir = await ensurePluginProcessDataDir({
        daemonDataDir: bridgeDataRoot,
        pluginId,
        kind: "bridge-data",
      });
      for (const declaration of declarations) {
        manifest[declaration.id] = {
          pluginId,
          dataDir,
          source: {
            kind: "artifact",
            digest: build.artifactDigest,
            artifactPath: build.jsPath,
          },
          providerOptions: integrationProviderOptions(pluginId, declaration),
          envPassthrough: [...(declaration.env?.passthrough ?? [])],
          capabilities: wireCapabilities(declaration),
        };
      }
    }
    await writeFile(
      INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH,
      JSON.stringify(manifest, null, 2),
    );
  } catch (error) {
    await stopRappBrainstem();
    throw error;
  }
}

export async function teardown(): Promise<void> {
  await stopRappBrainstem();
  await rm(INTEGRATION_RAPP_MODEL_REQUEST_PATH, { force: true });
}
