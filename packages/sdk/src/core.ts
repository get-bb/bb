import type { BbSdkContext, BbSdkTransport } from "./transport.js";
import { createAutomationsArea } from "./areas/automations.js";
import { createConnectArea } from "./areas/connect.js";
import { createEnvironmentsArea } from "./areas/environments.js";
import { createFilesArea } from "./areas/files.js";
import { createGuideArea } from "./areas/guide.js";
import { createHostsArea } from "./areas/hosts.js";
import { createProjectsArea } from "./areas/projects.js";
import { createProvidersArea } from "./areas/providers.js";
import { createBbRealtimeClient } from "./realtime-client.js";
import type { BbRealtime } from "./realtime-types.js";
import { createStatusArea } from "./areas/status.js";
import { createThemeArea } from "./areas/theme.js";
import { createThreadsArea } from "./areas/threads.js";

export interface CreateBbSdkArgs {
  context?: BbSdkContext;
  transport: BbSdkTransport;
}

export interface BbSdk extends BbRealtime {
  automations: ReturnType<typeof createAutomationsArea>;
  connect: ReturnType<typeof createConnectArea>;
  environments: ReturnType<typeof createEnvironmentsArea>;
  files: ReturnType<typeof createFilesArea>;
  guide: ReturnType<typeof createGuideArea>;
  hosts: ReturnType<typeof createHostsArea>;
  projects: ReturnType<typeof createProjectsArea>;
  providers: ReturnType<typeof createProvidersArea>;
  status: ReturnType<typeof createStatusArea>;
  theme: ReturnType<typeof createThemeArea>;
  threads: ReturnType<typeof createThreadsArea>;
}

export function createBbSdk(args: CreateBbSdkArgs): BbSdk {
  const context = args.context ?? {};
  const sdkContext = { transport: args.transport, context };
  const realtime = createBbRealtimeClient({
    transport: args.transport,
  });
  return {
    automations: createAutomationsArea(sdkContext),
    connect: createConnectArea(sdkContext),
    environments: createEnvironmentsArea(sdkContext),
    files: createFilesArea(sdkContext),
    guide: createGuideArea(),
    hosts: createHostsArea(sdkContext),
    on(args) {
      return realtime.on(args);
    },
    projects: createProjectsArea(sdkContext),
    providers: createProvidersArea(sdkContext),
    status: createStatusArea(sdkContext),
    theme: createThemeArea(sdkContext),
    threads: createThreadsArea(sdkContext),
  };
}
