import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { piProviderDeclaration } from "./src/declaration.js";

/**
 * First-party Pi provider plugin. The declaration is the only source of this
 * provider: disabling this plugin removes the provider. Pi's skill roots are
 * the plugin's fact, not core's: the documented directories are declared,
 * and the ones a host's pi `settings.json` names are resolved on that host
 * by the plugin's `bb.host` entry (`src/native-roots.ts`) when bb lists
 * skills there.
 */
export default function plugin(bb: BbPluginApi): void {
  const registered = bb.providers.register(piProviderDeclaration());
  bb.onDispose(() => {
    registered.dispose();
  });
}
