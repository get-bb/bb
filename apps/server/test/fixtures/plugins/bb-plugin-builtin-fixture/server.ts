import type { BbPluginApi } from "@get-bb/plugin-sdk";

declare global {
  var __builtinFixtureLoads: number | undefined;
}

export default function plugin(bb: BbPluginApi) {
  globalThis.__builtinFixtureLoads =
    (globalThis.__builtinFixtureLoads ?? 0) + 1;

  bb.cli.register({
    name: "builtin-fixture",
    summary: "Builtin fixture command",
    commands: [],
    run: async () => ({
      exitCode: 0,
      stdout: `builtin ${bb.pluginId}`,
    }),
  });
}
