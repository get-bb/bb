/**
 * The live-CLI integration suite's view of the first-party provider bridges.
 *
 * Every first-party bridge except Pi's now ships as a plugin artifact, and the
 * runtime has no bridge at all for such a provider unless the caller hands it
 * a `bridgeLaunch` — in production the server attaches one built from the
 * plugin's recorded artifact. `integration-global-setup.ts` builds those same
 * artifacts once per run and writes this manifest; the harness reads it
 * synchronously so `createTestRuntime` stays a plain constructor. Nothing is
 * stubbed: the tests launch the real built artifact.
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { permissionModeSchema, providerForkSchema } from "@bb/domain";
import { isAcpProviderId } from "../provider-catalog.js";
import type { AgentRuntimeBridgeLaunch } from "../types.js";

export const INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH = join(
  tmpdir(),
  "bb-agent-runtime-integration-provider-bridges.json",
);

const bridgeLaunchSchema = z.object({
  pluginId: z.string(),
  dataDir: z.string(),
  source: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("artifact"),
      digest: z.string(),
      artifactPath: z.string(),
    }),
    z.object({ kind: z.literal("daemon-bundled"), id: z.string() }),
  ]),
  capabilities: z.object({
    supportsServiceTier: z.boolean(),
    permissionModes: z.array(permissionModeSchema),
    supportsThreadArchive: z.boolean(),
    supportsThreadRename: z.boolean(),
    fork: providerForkSchema,
  }),
});

const manifestSchema = z.record(z.string(), bridgeLaunchSchema);

export type IntegrationProviderBridgeManifest = z.infer<typeof manifestSchema>;

let cachedManifest: IntegrationProviderBridgeManifest | null = null;

function readManifest(): IntegrationProviderBridgeManifest {
  if (cachedManifest !== null) {
    return cachedManifest;
  }
  let raw: string;
  try {
    raw = readFileSync(INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH, "utf8");
  } catch {
    throw new Error(
      `No provider bridge manifest at ${INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH}. ` +
        `Integration tests must run through vitest.integration.config.ts, whose ` +
        `global setup builds the first-party bridge artifacts.`,
    );
  }
  cachedManifest = manifestSchema.parse(JSON.parse(raw));
  return cachedManifest;
}

/**
 * The `bridgeLaunch` a live test must pass for this provider — an artifact for
 * a graduated plugin, or the daemon-bundled bridge id for Pi. Every provider
 * has one, exactly as on the wire.
 *
 * The ACP fallback mirrors the server's: `acp-*` ids other than the one the
 * plugin declares are resolved at request time and never registered, so they
 * borrow the ACP plugin's artifact.
 */
export function resolveIntegrationBridgeLaunch(
  providerId: string,
): AgentRuntimeBridgeLaunch {
  const manifest = readManifest();
  const direct = manifest[providerId];
  if (direct !== undefined) {
    return direct;
  }
  if (isAcpProviderId(providerId)) {
    const acpEntry = Object.entries(manifest).find(([id]) =>
      isAcpProviderId(id),
    );
    if (acpEntry) {
      return acpEntry[1];
    }
  }
  throw new Error(
    `No provider bridge artifact recorded for "${providerId}". ` +
      `Known: ${Object.keys(manifest).join(", ") || "none"}`,
  );
}
