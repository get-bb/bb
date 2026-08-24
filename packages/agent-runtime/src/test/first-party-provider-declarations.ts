/**
 * The provider declarations a first-party plugin registers, captured by
 * invoking its server entrypoint against the SDK's fake plugin host — the
 * same thing the plugin runtime does, so what a test puts on the wire cannot
 * drift from the declaration. Shared by the agent-runtime integration setup
 * and the server's test registries.
 *
 * The plugin modules load by dynamic import rather than a static one: they
 * live outside both packages' rootDir, exactly as they do for the real plugin
 * runtime, which also imports them as untyped modules and validates what
 * comes back (the fake host runs the same validator on every registration).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pluginPackageJsonSchema } from "@bb/domain";
import type { PluginSettingValue } from "@get-bb/plugin-sdk";
import type { NormalizedPluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";

/**
 * A first-party plugin's checkout root (`plugins/<pluginId>`). No trailing
 * slash: the plugin build's directory-escape checks compare against
 * `rootDir + "/"`.
 */
export function firstPartyPluginRootDir(pluginId: string): string {
  return fileURLToPath(
    new URL(`../../../../plugins/${pluginId}`, import.meta.url),
  );
}

/**
 * The icon names the plugin's manifest declares
 * (`bb.branding.experimental_icons`). A provider whose declaration names one
 * of them as a namespaced glyph (`"<pluginId>/<name>"`) registers only when
 * the host knows the name, so the capture reads the same manifest the plugin
 * runtime reads; without it every such registration is refused and the
 * plugin looks like it declared nothing.
 */
async function declaredIconNames(pluginId: string): Promise<string[]> {
  const manifest = pluginPackageJsonSchema.parse(
    JSON.parse(
      await readFile(
        path.join(firstPartyPluginRootDir(pluginId), "package.json"),
        "utf8",
      ),
    ),
  );
  return Object.keys(manifest.bb.branding.experimental_icons ?? {});
}

export interface CaptureFirstPartyProviderDeclarationsOptions {
  /**
   * Stored plugin settings, as if saved before this load. The provider
   * plugins define their settings before registering and read them while
   * doing so; without this every read answers the descriptor defaults.
   */
  settings?: Record<string, PluginSettingValue>;
}

/**
 * Run `plugins/<pluginId>/server.ts` against the fake plugin host and return
 * the declarations it registered, normalized the way the plugin runtime
 * stores them. The fake host serves the whole `BbPluginApi` (settings, AI
 * services, hosts, background services, dispose hooks), so an entry may use
 * any of it at load time, synchronously or asynchronously; background
 * services are registered but never started, and the host RPC throws (there
 * is no daemon here, which is exactly what a plugin sees on a server whose
 * hosts are all offline — it must still register its declarations).
 */
export async function captureFirstPartyProviderDeclarations(
  pluginId: string,
  options: CaptureFirstPartyProviderDeclarationsOptions = {},
): Promise<NormalizedPluginProviderDeclaration[]> {
  const moduleUrl = new URL(
    `../../../../plugins/${pluginId}/server.ts`,
    import.meta.url,
  ).href;
  const loaded: unknown = await import(/* @vite-ignore */ moduleUrl);
  const entry = (loaded as { default?: unknown }).default;
  if (typeof entry !== "function") {
    throw new Error(`${pluginId} has no default plugin export`);
  }
  const host = createFakePluginHost({
    pluginId,
    // The ACP plugin reads the deprecated `customAcpAgents` array out of the
    // server's data dir. Point it at a directory that holds no config.json
    // so the machine running the tests cannot add an agent to them.
    dataDir: firstPartyPluginRootDir("__no-such-data-dir__"),
    experimental_declaredIconNames: await declaredIconNames(pluginId),
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  });
  try {
    // Awaited: a plugin factory may be async, and one that registers after
    // its first await (the ACP plugin reads its settings) would otherwise
    // look like a plugin that registered nothing.
    await entry(host.bb);
    // Copy before dispose: disposing a registration removes it from the list.
    const captured = [...host.harness.registrations.providerRegistrations];
    if (captured.length === 0) {
      throw new Error(`${pluginId} registered no provider declaration`);
    }
    return captured;
  } finally {
    await host.harness.dispose();
  }
}
