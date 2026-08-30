import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { registerArcCli } from "./src/arc-cli.js";
import { ArcService } from "./src/arc-service.js";
import { arcRpcContract } from "./src/arcs.js";
import { riftProviderDeclaration } from "./src/declaration.js";

export default async function riftPlugin(bb: BbPluginApi): Promise<void> {
  const provider = bb.providers.register(riftProviderDeclaration());
  const arcs = new ArcService(bb);
  const publishArcChange = (): void => {
    bb.realtime.publish("arcs-changed", {});
  };

  bb.rpc.register(arcRpcContract, {
    async projects() {
      const projects = await bb.sdk.projects.list({ includePersonal: true });
      return projects.flatMap(({ id, name, sources }) => {
        const source = sources.find((candidate) => candidate.isDefault);
        return source === undefined
          ? []
          : [{ id, name, hostId: source.hostId, cwd: source.path }];
      });
    },
    overview: (input) => arcs.overview(input),
    list: (input) => arcs.list(input),
    read: (input) => arcs.read(input),
    authorize: async (input) => {
      const result = await arcs.authorize(input);
      publishArcChange();
      return result;
    },
    async create(input) {
      const result = await arcs.create(input);
      publishArcChange();
      return result;
    },
    async lifecycle(input) {
      const result = await arcs.lifecycle(input);
      publishArcChange();
      return result;
    },
    async destroy(input) {
      const result = await arcs.destroy(input);
      publishArcChange();
      return result;
    },
    spawnThread: (input) => arcs.spawnThread(input),
  });
  registerArcCli(bb, arcs);
  bb.onDispose(() => provider.dispose());
}
