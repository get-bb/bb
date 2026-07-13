import type { BbSdkContext, BbSdkTransport } from "./transport.js";
import { createEnvironmentsArea } from "./areas/environments.js";
import { createFilesArea } from "./areas/files.js";
import { createGuideArea } from "./areas/guide.js";
import { createHostsArea } from "./areas/hosts.js";
import { createProjectsArea } from "./areas/projects.js";
import { createProvidersArea } from "./areas/providers.js";
import { createPluginsArea } from "./areas/plugins.js";
import { createBbRealtimeClient } from "./realtime-client.js";
import type { BbRealtime } from "./realtime-types.js";
import { createStatusArea } from "./areas/status.js";
import { createThemeArea } from "./areas/theme.js";
import { createSystemArea } from "./areas/system.js";
import { createThreadsArea } from "./areas/threads.js";
import { createThreadFoldersArea } from "./areas/thread-folders.js";

export interface CreateBbSdkArgs {
  context?: BbSdkContext;
  transport: BbSdkTransport;
}

export interface BbSdk extends BbRealtime {
  environments: ReturnType<typeof createEnvironmentsArea>;
  files: ReturnType<typeof createFilesArea>;
  guide: ReturnType<typeof createGuideArea>;
  hosts: ReturnType<typeof createHostsArea>;
  projects: ReturnType<typeof createProjectsArea>;
  plugins: ReturnType<typeof createPluginsArea>;
  providers: ReturnType<typeof createProvidersArea>;
  status: ReturnType<typeof createStatusArea>;
  system: ReturnType<typeof createSystemArea>;
  theme: ReturnType<typeof createThemeArea>;
  threadFolders: ReturnType<typeof createThreadFoldersArea>;
  threads: ReturnType<typeof createThreadsArea>;
}

export function createBbSdk(args: CreateBbSdkArgs): BbSdk {
  const context = args.context ?? {};
  const sdkContext = { transport: args.transport, context };
  const realtime = createBbRealtimeClient({
    transport: args.transport,
  });
  return {
    environments: createEnvironmentsArea(sdkContext),
    files: createFilesArea(sdkContext),
    guide: createGuideArea(),
    hosts: createHostsArea(sdkContext),
    on(args) {
      return realtime.on(args);
    },
    projects: createProjectsArea(sdkContext),
    plugins: createPluginsArea(sdkContext),
    providers: createProvidersArea(sdkContext),
    status: createStatusArea(sdkContext),
    system: createSystemArea(sdkContext),
    theme: createThemeArea(sdkContext),
    threadFolders: createThreadFoldersArea(sdkContext),
    threads: createThreadsArea(sdkContext),
  };
}
