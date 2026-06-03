import type { BbSdkContext, BbSdkTransport } from "./transport.js";
import { createAppsArea, createCurrentAppDataArea, createCurrentAppMessageArea } from "./areas/apps.js";
import { createEnvironmentsArea } from "./areas/environments.js";
import { createGuideArea } from "./areas/guide.js";
import { createHostsArea } from "./areas/hosts.js";
import { createManagersArea } from "./areas/managers.js";
import { createProjectsArea } from "./areas/projects.js";
import { createProvidersArea } from "./areas/providers.js";
import { createReplayArea } from "./areas/replay.js";
import { createBbRealtimeClient } from "./realtime-client.js";
import type {
  BbRealtimeEventName,
  BbRealtimeOnInput,
  BbRealtimeUnsubscribe,
} from "./realtime-types.js";
import { createStatusArea } from "./areas/status.js";
import { createThreadsArea } from "./areas/threads.js";

export interface CreateBbSdkArgs {
  context?: BbSdkContext;
  transport: BbSdkTransport;
}

export interface BbSdk {
  applicationId?: string;
  appId?: string;
  apps: ReturnType<typeof createAppsArea>;
  data: ReturnType<typeof createCurrentAppDataArea>;
  environments: ReturnType<typeof createEnvironmentsArea>;
  guide: ReturnType<typeof createGuideArea>;
  hosts: ReturnType<typeof createHostsArea>;
  managers: ReturnType<typeof createManagersArea>;
  message: ReturnType<typeof createCurrentAppMessageArea>;
  on<TEventName extends BbRealtimeEventName>(
    input: BbRealtimeOnInput<TEventName>,
  ): BbRealtimeUnsubscribe;
  projects: ReturnType<typeof createProjectsArea>;
  providers: ReturnType<typeof createProvidersArea>;
  replay: ReturnType<typeof createReplayArea>;
  status: ReturnType<typeof createStatusArea>;
  threads: ReturnType<typeof createThreadsArea>;
}

export function createBbSdk(args: CreateBbSdkArgs): BbSdk {
  const context = args.context ?? {};
  const sdkContext = { transport: args.transport, context };
  const apps = createAppsArea(sdkContext);
  const realtime = createBbRealtimeClient({
    context,
    transport: args.transport,
    async listAppDataEntries(input) {
      const response = await apps.data.list(input);
      return response.entries;
    },
  });
  return {
    applicationId: context.applicationId,
    appId: context.applicationId,
    apps,
    data: createCurrentAppDataArea({
      ...sdkContext,
      apps,
      realtime,
    }),
    environments: createEnvironmentsArea(sdkContext),
    guide: createGuideArea(),
    hosts: createHostsArea(sdkContext),
    managers: createManagersArea(sdkContext),
    message: createCurrentAppMessageArea(sdkContext),
    on(input) {
      return realtime.on(input);
    },
    projects: createProjectsArea(sdkContext),
    providers: createProvidersArea(sdkContext),
    replay: createReplayArea(sdkContext),
    status: createStatusArea(sdkContext),
    threads: createThreadsArea(sdkContext),
  };
}
