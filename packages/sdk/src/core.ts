import type { BbSdkContext, BbSdkTransport } from "./transport.js";
import { createEnvironmentsArea } from "./areas/environments.js";
import { createGuideArea } from "./areas/guide.js";
import { createHostsArea } from "./areas/hosts.js";
import { createProjectsArea } from "./areas/projects.js";
import { createProvidersArea } from "./areas/providers.js";
import { createBbRealtimeClient } from "./realtime-client.js";
import type { BbRealtime } from "./realtime-types.js";
import { createStatusArea } from "./areas/status.js";
import { createThreadsArea } from "./areas/threads.js";

export interface CreateBbSdkArgs {
  context?: BbSdkContext;
  transport: BbSdkTransport;
}

export interface BbSdk extends BbRealtime {
  environments: ReturnType<typeof createEnvironmentsArea>;
  guide: ReturnType<typeof createGuideArea>;
  hosts: ReturnType<typeof createHostsArea>;
  projects: ReturnType<typeof createProjectsArea>;
  providers: ReturnType<typeof createProvidersArea>;
  status: ReturnType<typeof createStatusArea>;
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
    guide: createGuideArea(),
    hosts: createHostsArea(sdkContext),
    on(args) {
      return realtime.on(args);
    },
    projects: createProjectsArea(sdkContext),
    providers: createProvidersArea(sdkContext),
    status: createStatusArea(sdkContext),
    threads: createThreadsArea(sdkContext),
  };
}
