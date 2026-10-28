import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DynamicTool } from "@bb/domain";
import {
  BRIDGE_REQUEST_METHODS,
  threadIdentityResultSchema,
  type BridgeCapabilities,
  type BridgeSessionConfigApply,
} from "../index.js";
import {
  ConformanceClient,
  nextConformanceClientRequestId,
} from "./client.js";
import {
  defaultOptions,
  fail,
  pass,
  skipped,
  threadEvents,
  type ConformanceAgentObservation,
  type ConformanceSessionFixture,
  type ConformanceSessionProbe,
  type ScenarioContext,
} from "./scenarios.js";
import type { ConformanceCheckResult } from "./types.js";

const DECLARED_ID = "config/session-config-declared";
const DECLARED_TITLE =
  "the handshake declares how each session-config field is applied";
const ENV_ID = "config/env-reaches-agent";
const ENV_TITLE =
  "options.envVars, thread identity included, reach the agent process";
const TOOLS_AT_START_ID = "config/tools-at-start";
const TOOLS_AT_START_TITLE = "dynamicTools given at thread/start reach the agent";
const TOOLS_ADDED_ID = "config/tools-added-after-empty-start";
const TOOLS_ADDED_TITLE =
  "tools added after a thread started with none reach the agent";
const TOOLS_CHANGED_ID = "config/tools-change-applies";
const TOOLS_CHANGED_TITLE =
  "a changed tool definition replaces the one the agent had";
const TOOLS_REMOVED_ID = "config/tools-removed";
const TOOLS_REMOVED_TITLE = "a removed tool is no longer offered to the agent";
const SKILLS_PER_SESSION_ID = "config/skills-per-session";
const SKILLS_PER_SESSION_TITLE =
  "each session loads the skillRoots it was constructed with, not a sibling's";
const SKILLS_CHANGE_ISOLATED_ID = "config/skills-change-isolated";
const SKILLS_CHANGE_ISOLATED_TITLE =
  "a thread's changed skillRoots reach it and leave its sibling's skills alone";

const PROBE_ENV_NAME = "BB_CONFORMANCE_PROBE";
const PROBE_ENV_VALUE = "session-config";

function probeTool(name: string, description: string): DynamicTool {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
  };
}

const ALPHA_V1 = probeTool("conformance_alpha", "alpha, first revision");
const ALPHA_V2 = probeTool("conformance_alpha", "alpha, second revision");
const BETA = probeTool("conformance_beta", "beta");
const GAMMA = probeTool("conformance_gamma", "gamma");

interface SessionConfigScenarioArgs {
  client: ConformanceClient;
  fixture: ConformanceSessionFixture;
  capabilities: BridgeCapabilities | null;
  sessionConfigDeclared: boolean;
}

interface SkillRoot {
  id: string;
  path: string;
  skills: { name: string; description: string }[];
}

interface ProbedThread {
  threadId: string;
  providerThreadId: string;
}

const ALL_IDS: readonly (readonly [string, string])[] = [
  [ENV_ID, ENV_TITLE],
  [TOOLS_AT_START_ID, TOOLS_AT_START_TITLE],
  [TOOLS_ADDED_ID, TOOLS_ADDED_TITLE],
  [TOOLS_CHANGED_ID, TOOLS_CHANGED_TITLE],
  [TOOLS_REMOVED_ID, TOOLS_REMOVED_TITLE],
  [SKILLS_PER_SESSION_ID, SKILLS_PER_SESSION_TITLE],
  [SKILLS_CHANGE_ISOLATED_ID, SKILLS_CHANGE_ISOLATED_TITLE],
];

function skipAll(detail: string): ConformanceCheckResult[] {
  return ALL_IDS.map(([id, title]) => skipped(id, title, detail));
}

function toolSummary(observation: ConformanceAgentObservation): string {
  return JSON.stringify(
    observation.tools.map((tool) => `${tool.name}: ${tool.description}`),
  );
}

export async function runSessionConfigScenarios(
  args: SessionConfigScenarioArgs,
): Promise<ConformanceCheckResult[]> {
  const results: ConformanceCheckResult[] = [
    args.sessionConfigDeclared
      ? pass(DECLARED_ID, DECLARED_TITLE)
      : fail(
          DECLARED_ID,
          DECLARED_TITLE,
          'initialize must return capabilities.sessionConfig = { dynamicTools, skills }, each "live" (turn/start or skills/configure applies it to the running session), "resume" (thread/resume with the new value rebuilds the session) or "fixed" (the provider keeps the value it started with); the runtime assumes "resume" when it is missing',
        ),
  ];
  const probe = args.fixture.probe;
  if (probe === undefined) {
    return results;
  }
  if (args.capabilities === null) {
    return [...results, ...skipAll("prerequisite handshake/initialize failed")];
  }
  const runner = new SessionConfigRunner(args.client, args.fixture, probe);
  const toolsMode = args.capabilities.sessionConfig.dynamicTools;

  const empty = await runner.start("thr_conformance_config_empty", []);
  if (empty === null) {
    return [
      ...results,
      ...skipAll(`thread/start failed: ${runner.lastError}`),
    ];
  }
  const emptyObserved = await runner.observe(empty);
  results.push(
    emptyObserved === null
      ? fail(ENV_ID, ENV_TITLE, "the probe observed no agent session")
      : emptyObserved.env["BB_THREAD_ID"] === empty.threadId &&
          emptyObserved.env[PROBE_ENV_NAME] === PROBE_ENV_VALUE
        ? pass(ENV_ID, ENV_TITLE)
        : fail(
            ENV_ID,
            ENV_TITLE,
            `the agent process saw BB_THREAD_ID=${JSON.stringify(emptyObserved.env["BB_THREAD_ID"])} and ${PROBE_ENV_NAME}=${JSON.stringify(emptyObserved.env[PROBE_ENV_NAME])}; tools and MCP servers the agent launches inherit this env, so they cannot tell which thread they serve`,
          ),
  );

  const tooled = await runner.start("thr_conformance_config_tools", [ALPHA_V1]);
  if (tooled === null) {
    results.push(
      fail(TOOLS_AT_START_ID, TOOLS_AT_START_TITLE, runner.lastError),
    );
  } else {
    const observed = await runner.observe(tooled);
    results.push(
      observed?.tools.some(
        (tool) =>
          tool.name === ALPHA_V1.name &&
          tool.description === ALPHA_V1.description,
      ) === true
        ? pass(TOOLS_AT_START_ID, TOOLS_AT_START_TITLE)
        : fail(
            TOOLS_AT_START_ID,
            TOOLS_AT_START_TITLE,
            observed === null
              ? "the probe observed no agent session"
              : `the agent was given ${toolSummary(observed)}`,
          ),
    );
  }

  if (toolsMode === "fixed") {
    const detail =
      'the bridge declares sessionConfig.dynamicTools "fixed": the runtime keeps a session\'s start-time tools and warns instead';
    results.push(
      skipped(TOOLS_ADDED_ID, TOOLS_ADDED_TITLE, detail),
      skipped(TOOLS_CHANGED_ID, TOOLS_CHANGED_TITLE, detail),
      skipped(TOOLS_REMOVED_ID, TOOLS_REMOVED_TITLE, detail),
    );
  } else {
    results.push(
      await runner.checkToolChange({
        id: TOOLS_ADDED_ID,
        title: TOOLS_ADDED_TITLE,
        thread: empty,
        mode: toolsMode,
        tools: [BETA],
        expect: (observed) =>
          observed.tools.some((tool) => tool.name === BETA.name),
      }),
    );
    if (tooled === null) {
      results.push(
        skipped(TOOLS_CHANGED_ID, TOOLS_CHANGED_TITLE, runner.lastError),
        skipped(TOOLS_REMOVED_ID, TOOLS_REMOVED_TITLE, runner.lastError),
      );
    } else {
      results.push(
        await runner.checkToolChange({
          id: TOOLS_CHANGED_ID,
          title: TOOLS_CHANGED_TITLE,
          thread: tooled,
          mode: toolsMode,
          tools: [ALPHA_V2, GAMMA],
          expect: (observed) =>
            observed.tools.some(
              (tool) =>
                tool.name === ALPHA_V2.name &&
                tool.description === ALPHA_V2.description,
            ) &&
            !observed.tools.some(
              (tool) => tool.description === ALPHA_V1.description,
            ) &&
            observed.tools.some((tool) => tool.name === GAMMA.name),
        }),
        await runner.checkToolChange({
          id: TOOLS_REMOVED_ID,
          title: TOOLS_REMOVED_TITLE,
          thread: tooled,
          mode: toolsMode,
          tools: [GAMMA],
          expect: (observed) =>
            !observed.tools.some((tool) => tool.name === ALPHA_V2.name) &&
            observed.tools.some((tool) => tool.name === GAMMA.name),
        }),
      );
    }
  }

  await runner.release(empty);
  if (tooled !== null) {
    await runner.release(tooled);
  }
  results.push(
    ...(await runSkillIsolationScenarios(runner, args.capabilities)),
  );
  return results;
}

function writeSkillRoot(id: string, skillName: string): SkillRoot {
  const path = mkdtempSync(join(tmpdir(), "bb-conformance-skills-"));
  mkdirSync(join(path, skillName));
  const description = `conformance skill ${skillName}`;
  writeFileSync(
    join(path, skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: ${description}\n---\nReply with ${skillName}.\n`,
  );
  return { id, path, skills: [{ name: skillName, description }] };
}

function hasOnly(
  observed: ConformanceAgentObservation,
  present: string,
  absent: readonly string[],
): boolean {
  const skills = observed.skills ?? [];
  return (
    skills.includes(present) && !absent.some((name) => skills.includes(name))
  );
}

async function runSkillIsolationScenarios(
  runner: SessionConfigRunner,
  capabilities: BridgeCapabilities,
): Promise<ConformanceCheckResult[]> {
  const skipBoth = (detail: string): ConformanceCheckResult[] => [
    skipped(SKILLS_PER_SESSION_ID, SKILLS_PER_SESSION_TITLE, detail),
    skipped(SKILLS_CHANGE_ISOLATED_ID, SKILLS_CHANGE_ISOLATED_TITLE, detail),
  ];
  if (!capabilities.skills.configure || !capabilities.skills.perSession) {
    return skipBoth(
      "the bridge does not declare skills.configure and skills.perSession; the runtime gives each skill catalog its own bridge process instead",
    );
  }
  const roots = {
    a: writeSkillRoot("conformance-skills-a", "conformance-skill-a"),
    b: writeSkillRoot("conformance-skills-b", "conformance-skill-b"),
    c: writeSkillRoot("conformance-skills-c", "conformance-skill-c"),
    d: writeSkillRoot("conformance-skills-d", "conformance-skill-d"),
  };
  const names = {
    a: "conformance-skill-a",
    b: "conformance-skill-b",
    c: "conformance-skill-c",
    d: "conformance-skill-d",
  };
  const results: ConformanceCheckResult[] = [];
  const first = await runner.start("thr_conformance_skills_a", [], [roots.a]);
  const second =
    first === null
      ? null
      : await runner.start("thr_conformance_skills_b", [], [roots.b]);
  try {
    if (first === null || second === null) {
      return skipBoth(`thread/start failed: ${runner.lastError}`);
    }
    const firstObserved = await runner.observe(first);
    const secondObserved = await runner.observe(second);
    if (firstObserved === null || secondObserved === null) {
      return [
        fail(
          SKILLS_PER_SESSION_ID,
          SKILLS_PER_SESSION_TITLE,
          "the probe observed no agent session",
        ),
        skipped(
          SKILLS_CHANGE_ISOLATED_ID,
          SKILLS_CHANGE_ISOLATED_TITLE,
          "the probe observed no agent session",
        ),
      ];
    }
    if (
      firstObserved.skills === undefined ||
      secondObserved.skills === undefined
    ) {
      return skipBoth("the fixture probe does not observe skills");
    }
    results.push(
      hasOnly(firstObserved, names.a, [names.b]) &&
        hasOnly(secondObserved, names.b, [names.a])
        ? pass(SKILLS_PER_SESSION_ID, SKILLS_PER_SESSION_TITLE)
        : fail(
            SKILLS_PER_SESSION_ID,
            SKILLS_PER_SESSION_TITLE,
            `a thread started with ${names.a} saw ${JSON.stringify(firstObserved.skills)}; one started with ${names.b} saw ${JSON.stringify(secondObserved.skills)}`,
          ),
    );
    const mode = capabilities.sessionConfig.skills;
    if (mode === "fixed") {
      results.push(
        skipped(
          SKILLS_CHANGE_ISOLATED_ID,
          SKILLS_CHANGE_ISOLATED_TITLE,
          'the bridge declares sessionConfig.skills "fixed": the runtime keeps a session\'s start-time skills and warns instead',
        ),
      );
      return results;
    }
    if (!(await runner.configureSkills([roots.d]))) {
      results.push(
        fail(
          SKILLS_CHANGE_ISOLATED_ID,
          SKILLS_CHANGE_ISOLATED_TITLE,
          runner.lastError,
        ),
      );
      return results;
    }
    if (!(await runner.applyChange({ thread: second, mode, skillRoots: [roots.c] }))) {
      results.push(
        fail(
          SKILLS_CHANGE_ISOLATED_ID,
          SKILLS_CHANGE_ISOLATED_TITLE,
          runner.lastError,
        ),
      );
      return results;
    }
    if (!(await runner.turn(first))) {
      results.push(
        fail(
          SKILLS_CHANGE_ISOLATED_ID,
          SKILLS_CHANGE_ISOLATED_TITLE,
          runner.lastError,
        ),
      );
      return results;
    }
    const firstAfter = await runner.observe(first);
    const secondAfter = await runner.observe(second);
    results.push(
      firstAfter !== null &&
        secondAfter !== null &&
        hasOnly(firstAfter, names.a, [names.b, names.c, names.d]) &&
        hasOnly(secondAfter, names.c, [names.a, names.b, names.d])
        ? pass(SKILLS_CHANGE_ISOLATED_ID, SKILLS_CHANGE_ISOLATED_TITLE)
        : fail(
            SKILLS_CHANGE_ISOLATED_ID,
            SKILLS_CHANGE_ISOLATED_TITLE,
            `after skills/configure with ${names.d} and changing the second thread to ${names.c} by ${mode === "live" ? "turn/start" : "thread/resume"}, the first thread saw ${JSON.stringify(firstAfter?.skills ?? null)} and the second ${JSON.stringify(secondAfter?.skills ?? null)}`,
          ),
    );
    return results;
  } finally {
    if (first !== null) await runner.release(first);
    if (second !== null) await runner.release(second);
    for (const root of Object.values(roots)) {
      rmSync(root.path, { recursive: true, force: true });
    }
  }
}

class SessionConfigRunner {
  lastError = "";

  constructor(
    private readonly client: ConformanceClient,
    private readonly fixture: ConformanceSessionFixture,
    private readonly probe: ConformanceSessionProbe,
  ) {}

  private options(threadId: string): Record<string, unknown> {
    const base = defaultOptions(this.fixture);
    const envVars =
      typeof base["envVars"] === "object" && base["envVars"] !== null
        ? base["envVars"]
        : {};
    return {
      ...base,
      envVars: {
        ...envVars,
        BB_THREAD_ID: threadId,
        [PROBE_ENV_NAME]: PROBE_ENV_VALUE,
      },
    };
  }

  private context(): ScenarioContext {
    return {
      client: this.client,
      fixture: this.fixture,
      resolveProviderTurnId: () => undefined,
      fork: "none",
    };
  }

  private async construct(
    method: string,
    params: Record<string, unknown>,
  ): Promise<string | null> {
    const id = this.client.request(method, params);
    const response = await this.client.waitForResponse(id);
    if (response === null) {
      this.lastError = `${method} was not answered`;
      return null;
    }
    if (response.error !== undefined) {
      this.lastError = `${method} failed: ${JSON.stringify(response.error)}`;
      return null;
    }
    const parsed = threadIdentityResultSchema.safeParse(response.result);
    if (!parsed.success) {
      this.lastError = `${method} returned no providerThreadId`;
      return null;
    }
    return parsed.data.providerThreadId;
  }

  async start(
    threadId: string,
    dynamicTools: DynamicTool[],
    skillRoots?: SkillRoot[],
  ): Promise<ProbedThread | null> {
    const providerThreadId = await this.construct(
      BRIDGE_REQUEST_METHODS.threadStart,
      {
        threadId,
        cwd: this.fixture.cwd,
        options: this.options(threadId),
        dynamicTools,
        ...(skillRoots !== undefined ? { skillRoots } : {}),
        instructionMode: "append",
      },
    );
    if (providerThreadId === null) {
      return null;
    }
    const thread = { threadId, providerThreadId };
    return (await this.runTurn(thread, {})) ? thread : null;
  }

  async turn(thread: ProbedThread): Promise<boolean> {
    return this.runTurn(thread, {});
  }

  async configureSkills(roots: SkillRoot[]): Promise<boolean> {
    const id = this.client.request(BRIDGE_REQUEST_METHODS.skillsConfigure, {
      roots,
    });
    const response = await this.client.waitForResponse(id);
    if (response === null || response.error !== undefined) {
      this.lastError =
        response === null
          ? "skills/configure was not answered"
          : `skills/configure failed: ${JSON.stringify(response.error)}`;
      return false;
    }
    return true;
  }

  async applyChange(args: {
    thread: ProbedThread;
    mode: Exclude<BridgeSessionConfigApply, "fixed">;
    dynamicTools?: DynamicTool[];
    skillRoots?: SkillRoot[];
  }): Promise<boolean> {
    const change = {
      ...(args.dynamicTools !== undefined
        ? { dynamicTools: args.dynamicTools }
        : {}),
      ...(args.skillRoots !== undefined ? { skillRoots: args.skillRoots } : {}),
    };
    if (args.mode === "resume") {
      const providerThreadId = await this.construct(
        BRIDGE_REQUEST_METHODS.threadResume,
        {
          threadId: args.thread.threadId,
          cwd: this.fixture.cwd,
          providerThreadId: args.thread.providerThreadId,
          options: this.options(args.thread.threadId),
          ...change,
          instructionMode: "append",
        },
      );
      if (providerThreadId === null) {
        return false;
      }
      args.thread.providerThreadId = providerThreadId;
    }
    return this.runTurn(args.thread, args.mode === "live" ? change : {});
  }

  private async runTurn(
    thread: ProbedThread,
    change: { dynamicTools?: DynamicTool[]; skillRoots?: SkillRoot[] },
  ): Promise<boolean> {
    const completedBefore = this.completedTurns(thread.threadId);
    const id = this.client.request(BRIDGE_REQUEST_METHODS.turnStart, {
      threadId: thread.threadId,
      providerThreadId: thread.providerThreadId,
      input: this.fixture.promptInput,
      clientRequestId: nextConformanceClientRequestId(),
      options: this.options(thread.threadId),
      ...change,
    });
    const response = await this.client.waitForResponse(id);
    if (response === null || response.error !== undefined) {
      this.lastError =
        response === null
          ? "turn/start was not answered"
          : `turn/start failed: ${JSON.stringify(response.error)}`;
      return false;
    }
    const settled = await this.client.waitFor(() =>
      this.completedTurns(thread.threadId) > completedBefore ? true : undefined,
    );
    if (settled === null) {
      this.lastError = "the turn never settled";
      return false;
    }
    return true;
  }

  private completedTurns(threadId: string): number {
    return threadEvents(this.context(), threadId).filter(
      (event) => event.type === "turn/completed",
    ).length;
  }

  async observe(
    thread: ProbedThread,
  ): Promise<ConformanceAgentObservation | null> {
    return this.probe.observe(thread);
  }

  async checkToolChange(args: {
    id: string;
    title: string;
    thread: ProbedThread;
    mode: Exclude<BridgeSessionConfigApply, "fixed">;
    tools: DynamicTool[];
    expect: (observed: ConformanceAgentObservation) => boolean;
  }): Promise<ConformanceCheckResult> {
    const ran = await this.applyChange({
      thread: args.thread,
      mode: args.mode,
      dynamicTools: args.tools,
    });
    if (!ran) {
      return fail(args.id, args.title, this.lastError);
    }
    const observed = await this.observe(args.thread);
    if (observed === null) {
      return fail(args.id, args.title, "the probe observed no agent session");
    }
    return args.expect(observed)
      ? pass(args.id, args.title)
      : fail(
          args.id,
          args.title,
          `after applying ${JSON.stringify(args.tools.map((tool) => `${tool.name}: ${tool.description}`))} by ${args.mode === "live" ? "turn/start" : "thread/resume"}, the agent was given ${toolSummary(observed)}`,
        );
  }

  async release(thread: ProbedThread): Promise<void> {
    const id = this.client.request(BRIDGE_REQUEST_METHODS.threadStop, {
      threadId: thread.threadId,
      providerThreadId: thread.providerThreadId,
      intent: "release",
      activeTurnId: null,
    });
    await this.client.waitForResponse(id);
  }
}
