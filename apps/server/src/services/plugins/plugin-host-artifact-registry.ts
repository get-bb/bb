import type { PluginHostArtifactSnapshot } from "./plugin-service-internal.js";

/**
 * The live `bb.host` artifact of every loaded plugin, keyed by plugin id.
 *
 * One map, two consumers, which is the whole point of the shape: the host RPC
 * transport reads it to materialize a worker, and provider-bridge launch
 * resolution reads it to name the bridge a thread command must run. The plugin
 * runtime owns writes — it publishes on load commit and removes on dispose, so
 * presence means "this plugin's runtime is live and its artifact is servable".
 *
 * It is constructed by the composition root rather than privately by the
 * runtime because both consumers sit outside the plugin service.
 */
export class PluginHostArtifactRegistry {
  readonly #byPluginId = new Map<string, PluginHostArtifactSnapshot>();

  set(pluginId: string, artifact: PluginHostArtifactSnapshot): void {
    this.#byPluginId.set(pluginId, artifact);
  }

  delete(pluginId: string): void {
    this.#byPluginId.delete(pluginId);
  }

  get(pluginId: string): PluginHostArtifactSnapshot | undefined {
    return this.#byPluginId.get(pluginId);
  }

  entries(): IterableIterator<[string, PluginHostArtifactSnapshot]> {
    return this.#byPluginId.entries();
  }
}
