import { createStorage } from "./storage.js";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { storageRpc } from "./contract.js";
import { createService } from "./service.js";
import { registerCli } from "./cli.js";

export default function plugin(bb: BbPluginApi) {
  const service = createService(bb);
  const storage = createStorage(bb);
  bb.rpc.register(storageRpc, {
    hosts: () => storage.hosts(),
    host: storage.host,
    scanHost: storage.scanHost,
    scanAll: () => storage.scanAll(),
    removeOrphans: storage.removeOrphans,
    clearLargeFiles: storage.clearLargeFiles,
    retryWorktreeCleanup: storage.retryWorktreeCleanup,
    clearThread: storage.clearThread,
    state: () => service.state(),
    preview: (policy) => service.preview(policy),
    configure: (policy) => service.configure(policy),
  });
  registerCli(bb, service, storage);
  bb.background.schedule("retention", "0 * * * *", () => service.sweep());
}
