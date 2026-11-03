import { BB_DOCS_URL } from "@bb/domain/docs-links";
import { templateDefinitions, type TemplateId } from "@bb/templates/generated";
import {
  DEFAULT_GUIDE_SEARCH_DOCS_TIMEOUT_MS,
  fetchDocsDocuments,
  fetchGuideSearchIndex,
  guideChapterDocuments,
  loadSkillDocuments,
  parseGuideSearchQuery,
  rankGuideSearchDocuments,
  type GuideSearchIndexFetcher,
  type GuideSearchResponse,
  type GuideSkillSource,
} from "./guide-search.js";

export type {
  GuideSearchDocsStatus,
  GuideSearchIndexFetcher,
  GuideSearchResponse,
  GuideSearchResult,
  GuideSearchSkillsStatus,
  GuideSearchSource,
  GuideSkillSource,
} from "./guide-search.js";

export interface GuideRenderArgs {
  chapter?: string;
}

export interface GuideRenderResult {
  chapter?: string;
  content: string;
}

export interface GuideSearchArgs {
  query: string;
  limit?: number;
  projectId: string;
  environmentId: string | null;
}

export interface GuideArea {
  render(args?: GuideRenderArgs): GuideRenderResult;
  search(args: GuideSearchArgs): Promise<GuideSearchResponse>;
}

export interface CreateGuideAreaOptions {
  docsBaseUrl?: string;
  docsTimeoutMs?: number;
  fetchIndex?: GuideSearchIndexFetcher;
  skills?: GuideSkillSource;
}

function defaultDocsBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = env.BB_DOCS_URL?.trim();
  if (configured === undefined || configured.length === 0) {
    return BB_DOCS_URL;
  }
  const url = new URL(configured);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("BB_DOCS_URL must be an http or https URL.");
  }
  return url.toString().replace(/\/+$/u, "");
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

export function createGuideArea(
  options: CreateGuideAreaOptions = {},
): GuideArea {
  return {
    async search(args) {
      const { query, limit } = parseGuideSearchQuery(args);
      const docsBaseUrl =
        options.docsBaseUrl ?? defaultDocsBaseUrl(process.env);
      const chapters = [
        { chapter: null, content: renderStaticTemplate("bbGuideOverview") },
        ...Object.entries(guideChapters).map(([chapter, templateId]) => ({
          chapter,
          content: renderStaticTemplate(templateId),
        })),
      ];
      const [docs, skills] = await Promise.all([
        fetchDocsDocuments({
          docsBaseUrl,
          timeoutMs:
            options.docsTimeoutMs ?? DEFAULT_GUIDE_SEARCH_DOCS_TIMEOUT_MS,
          fetchIndex: options.fetchIndex ?? fetchGuideSearchIndex,
        }),
        loadSkillDocuments({
          skills: options.skills ?? null,
          projectId: args.projectId,
          environmentId: args.environmentId,
        }),
      ]);
      const documents = [
        ...docs.documents,
        ...guideChapterDocuments(chapters),
        ...skills.documents,
      ];
      return {
        query,
        results: rankGuideSearchDocuments(query, documents, limit),
        docs: docs.status,
        skills: skills.status,
      };
    },
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
