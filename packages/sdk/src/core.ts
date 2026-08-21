import type { BbSdkContext, BbSdkTransport } from "./transport.js";
import {
  createEnvironmentsArea,
  type EnvironmentsArea,
} from "./areas/environments.js";
import { createFilesArea, type FilesArea } from "./areas/files.js";
import type { GuideArea } from "./areas/guide.js";
import { createHostsArea, type HostsArea } from "./areas/hosts.js";
import { createProjectsArea, type ProjectsArea } from "./areas/projects.js";
import { createProvidersArea, type ProvidersArea } from "./areas/providers.js";
import { createPluginsArea, type PluginsArea } from "./areas/plugins.js";
import { createBbRealtimeClient } from "./realtime-client.js";
import type { BbRealtime } from "./realtime-types.js";
import { createStatusArea, type StatusArea } from "./areas/status.js";
import { createSkillsArea, type SkillsArea } from "./areas/skills.js";
import { createThemeArea, type ThemeArea } from "./areas/theme.js";
import { createSystemArea, type SystemArea } from "./areas/system.js";
import { createTerminalsArea, type TerminalsArea } from "./areas/terminals.js";
import { createThreadsArea, type ThreadsArea } from "./areas/threads.js";
import {
  createThreadSectionsArea,
  type ThreadSectionsArea,
} from "./areas/thread-sections.js";

export type * from "./public-types.js";
// Structured prompt input for the provider's plan action; pass it as
// `input` to `threads.spawn` / `threads.send` (the CLI's `--plan`).
export { createBuiltinPlanCommandTextInput } from "@bb/domain";

export interface CreateBbSdkArgs {
  context?: BbSdkContext;
  transport: BbSdkTransport;
}

export interface CreateBbSdkWithGuideArgs extends CreateBbSdkArgs {
  guide: GuideArea;
}

/**
 * Every server-backed SDK area. The Node SDK adds the local `guide` area on
 * top of this; the browser SDK omits it so the generated guide templates
 * (~112 KB of markdown) stay out of the web app's boot chunk.
 */
export interface BbSdkAreas extends BbRealtime {
  environments: EnvironmentsArea;
  files: FilesArea;
  hosts: HostsArea;
  projects: ProjectsArea;
  plugins: PluginsArea;
  providers: ProvidersArea;
  skills: SkillsArea;
  status: StatusArea;
  system: SystemArea;
  terminals: TerminalsArea;
  theme: ThemeArea;
  threadSections: ThreadSectionsArea;
  threads: ThreadsArea;
}

export interface BbSdk extends BbSdkAreas {
  guide: GuideArea;
}

export function createBbSdk(args: CreateBbSdkWithGuideArgs): BbSdk;
export function createBbSdk(args: CreateBbSdkArgs): BbSdkAreas;
export function createBbSdk(
  args: CreateBbSdkArgs | CreateBbSdkWithGuideArgs,
): BbSdkAreas | BbSdk {
  const sdkContext = { transport: args.transport };
  const realtime = createBbRealtimeClient({
    transport: args.transport,
  });
  const areas: BbSdkAreas = {
    environments: createEnvironmentsArea(sdkContext),
    files: createFilesArea(sdkContext),
    hosts: createHostsArea(sdkContext),
    subscribe(args) {
      return realtime.subscribe(args);
    },
    projects: createProjectsArea(sdkContext),
    plugins: createPluginsArea(sdkContext),
    providers: createProvidersArea(sdkContext),
    skills: createSkillsArea(sdkContext),
    status: createStatusArea(sdkContext),
    system: createSystemArea(sdkContext),
    terminals: createTerminalsArea(sdkContext),
    theme: createThemeArea(sdkContext),
    threadSections: createThreadSectionsArea(sdkContext),
    threads: createThreadsArea(sdkContext),
  };
  return "guide" in args ? { ...areas, guide: args.guide } : areas;
}
