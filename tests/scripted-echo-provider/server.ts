import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function scriptedEchoProvider(bb: BbPluginApi): void {
  bb.settings.define({
    unavailable: { type: "boolean", label: "Unavailable", default: false },
  });
  bb.providers.experimental_registerExecutionIntegration({
    id: "scripted-execution",
    displayName: "Scripted execution",
    providers: ["codex", "pi", "fake-alpha", "fake-beta"].map((id) => ({
      id,
      displayName: id,
      maintenance: { health: true, usage: false, installation: false },
      capabilities: {
        supportsServiceTier: false,
        supportsNativeUserQuestion: false,
        fork: "checkpoint",
        supportsManualCompaction: false,
        supportsThreadArchive: true,
        supportsThreadRename: true,
        permissionModes: ["accept-edits", "auto", "full"],
        reasoningLevels: ["low", "medium", "high"],
      },
      composerActions: [],
      experimental_bridgeOptions: { executionOwner: "integration" },
      deriveProviderOptions(context) {
        if (context.settings.unavailable)
          throw new Error("Fixture execution service is unavailable");
        return {
          executionOwner: "integration",
          harness: id,
          model: context.model,
        };
      },
    })),
  });
}
