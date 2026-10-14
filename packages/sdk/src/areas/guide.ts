import { templateDefinitions, type TemplateId } from "@bb/templates/generated";

export interface GuideRenderArgs {
  chapter?: string;
}

export interface GuideRenderResult {
  chapter?: string;
  content: string;
}

export interface GuideArea {
  render(args?: GuideRenderArgs): GuideRenderResult;
}

const guideChapters: Record<string, TemplateId> = {
  threads: "bbGuideThreads",
  "thread-inspection": "bbGuideThreadInspection",
  "thread-messaging": "bbGuideThreadMessaging",
  "thread-lifecycle": "bbGuideThreadLifecycle",
  environments: "bbGuideEnvironments",
  "agent-configuration": "bbGuideAgentConfiguration",
  providers: "bbGuideProviders",
  projects: "bbGuideProjects",
  machines: "bbGuideMachines",
  terminals: "bbGuideTerminals",
  browser: "bbGuideBrowser",
  customization: "bbGuideCustomization",
  plugins: "bbGuidePlugins",
  json: "bbGuideJson",
};

const guideChapterAliases: Record<string, string> = {
  thread: "threads",
  spawn: "threads",
  fork: "threads",
  permission: "threads",
  permissions: "threads",
  inspection: "thread-inspection",
  inspect: "thread-inspection",
  wait: "thread-inspection",
  section: "thread-inspection",
  sections: "thread-inspection",
  messaging: "thread-messaging",
  message: "thread-messaging",
  messages: "thread-messaging",
  tell: "thread-messaging",
  interaction: "thread-messaging",
  interactions: "thread-messaging",
  queue: "thread-messaging",
  lifecycle: "thread-lifecycle",
  retry: "thread-lifecycle",
  archive: "thread-lifecycle",
  environment: "environments",
  env: "environments",
  worktree: "environments",
  worktrees: "environments",
  agent: "agent-configuration",
  agents: "agent-configuration",
  skill: "agent-configuration",
  skills: "agent-configuration",
  provider: "providers",
  model: "providers",
  models: "providers",
  project: "projects",
  machine: "machines",
  host: "machines",
  hosts: "machines",
  server: "machines",
  terminal: "terminals",
  theme: "customization",
  settings: "customization",
  plugin: "plugins",
  marketplace: "plugins",
  automation: "plugins",
  automations: "plugins",
  "json-output": "json",
  output: "json",
  errors: "json",
};

function resolveGuideChapter(chapter: string): string {
  const normalized = chapter.trim().toLowerCase();
  return guideChapterAliases[normalized] ?? normalized;
}

const templateBodyById = new Map(
  templateDefinitions.map((template) => [template.id, template.body]),
);

function renderStaticTemplate(templateId: TemplateId): string {
  const body = templateBodyById.get(templateId);
  if (body === undefined) {
    throw new Error(`Template '${templateId}' is unavailable.`);
  }
  return body;
}

export function createGuideArea(): GuideArea {
  return {
    render(input = {}) {
      if (!input.chapter) {
        return { content: renderStaticTemplate("bbGuideOverview") };
      }
      const chapter = resolveGuideChapter(input.chapter);
      const templateId = guideChapters[chapter];
      if (!templateId) {
        const available = Object.keys(guideChapters).join(", ");
        throw new Error(
          `Unknown guide chapter '${input.chapter}'. Available: ${available}. Commands contributed by plugins document themselves: run \`bb <command> --help\`.`,
        );
      }
      return {
        chapter,
        content: renderStaticTemplate(templateId),
      };
    },
  };
}
