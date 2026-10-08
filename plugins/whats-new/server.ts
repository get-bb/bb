import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { whatsNewRpcContract } from "./contract.js";

export default async function whatsNewPlugin(bb: BbPluginApi): Promise<void> {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Show What's new",
      description:
        "Show a card above the sidebar footer after each bb update, and the release notes in Settings → Updates.",
      default: true,
    },
  });

  bb.rpc.register(whatsNewRpcContract, {
    async setEnabled({ enabled }) {
      await settings.experimental_set({ enabled });
      return { ok: true as const };
    },
  });
}
