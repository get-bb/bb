import { z } from "zod";
import { gitRpcContract } from "bb-plugin-bb--git/contract";
import {
  environmentDiffResponseSchema,
  environmentStatusResponseSchema,
  environmentDiffFilesResponseSchema,
} from "bb-plugin-bb--git/read-contract";
import type {
  AvailableModel,
  Environment,
  Host,
  PendingInteraction,
  Thread,
  ThreadExecutionOptions,
  ThreadEventRow,
} from "@bb/domain";
import type { ThreadGitDiffResponse } from "bb-git-contract";
import {
  environmentSchema,
  hostSchema,
  pendingInteractionSchema,
  resolveEnvironmentMergeBaseBranch,
  threadEventRowSchema,
  threadSchema,
} from "@bb/domain";
import { listPreferredTestModels } from "@bb/test-helpers";
import type {
  CreateProjectRequest,
  CreateThreadRequest,
  EnvironmentActionRequest,
  EnvironmentActionResponse,
  ProjectResponse,
  ResolvePendingInteractionRequest,
  SendMessageRequest,
  ThreadPendingInteractionsResponse,
  ThreadTimelineResponse,
  ThreadResponse,
  UnmanagedBranchSpec,
  UpdateThreadRequest,
  WorkspaceArgs,
} from "@bb/server-contract";
import {
  createPublicApiClient,
  environmentActionResponseSchema,
  projectResponseSchema,
  systemExecutionOptionsResponseSchema,
  threadPendingInteractionsResponseSchema,
  threadResponseSchema,
  threadTimelineResponseSchema,
  THREAD_EVENT_LIST_PAGE_SIZE,
} from "@bb/server-contract";

export interface CreateHostThreadOptions {
  execution?: ThreadExecutionRequestOptions;
  hostId: string;
  input?: CreateThreadRequest["input"];
  parentThreadId?: string;
  projectId: string;
  providerId?: string;
  title?: string;
  workspace:
    | { type: "managed-worktree" }
    | { type: "personal" }
    | { branch?: UnmanagedBranchSpec; path: string | null; type: "unmanaged" };
}

export interface CreateReuseThreadOptions {
  execution?: ThreadExecutionRequestOptions;
  environmentId: string;
  input?: CreateThreadRequest["input"];
  parentThreadId?: string;
  projectId: string;
  providerId?: string;
  title?: string;
}

export type ThreadExecutionRequestOptions = Pick<
  ThreadExecutionOptions,
  "model" | "reasoningLevel" | "permissionMode" | "serviceTier"
>;

export interface SendTextMessageOptions {
  execution?: ThreadExecutionRequestOptions;
  mode?: "auto" | "start" | "steer";
  text: string;
}

export interface GetThreadTimelineOptions {
  includeNestedRows?: boolean;
}

export interface GetAvailableModelsOptions {
  hostId?: string;
  providerId?: string;
}

type PublicApiClient = ReturnType<typeof createPublicApiClient>;
const DEFAULT_THREAD_BOOTSTRAP_TEXT =
  "Reply with exactly READY and nothing else.";
const DEFAULT_PUBLIC_TEST_THREAD_ORIGIN = "app";

interface ResolveThreadInteractionArgs {
  api: PublicApiClient;
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
  threadId: string;
}

async function expectStatus(
  response: Response,
  expectedStatus: number,
  label: string,
): Promise<void> {
  if (response.status === expectedStatus) {
    return;
  }

  const body = await response.text();
  throw new Error(`${label} failed with ${response.status}: ${body}`);
}

function defaultThreadInput(text: string): CreateThreadRequest["input"] {
  return [{ type: "text", text, mentions: [] }];
}

function defaultModelForProvider(providerId: string): string {
  return listPreferredTestModels(providerId)[0] ?? `${providerId}-model`;
}

function toWorkspaceArgs(
  workspace: CreateHostThreadOptions["workspace"],
): WorkspaceArgs {
  if (workspace.type === "unmanaged" || workspace.type === "personal") {
    return workspace;
  }
  return { ...workspace, baseBranch: { kind: "default" } };
}

function requireEnvironmentMergeBaseBranch(environment: Environment): string {
  const mergeBaseBranch = resolveEnvironmentMergeBaseBranch(environment);
  if (!mergeBaseBranch) {
    throw new Error(`Environment ${environment.id} has no merge base branch`);
  }
  return mergeBaseBranch;
}

async function requireMergeBaseBranch(
  api: PublicApiClient,
  environmentId: string,
): Promise<string> {
  const environment = await getEnvironment(api, environmentId);
  return requireEnvironmentMergeBaseBranch(environment);
}

export async function archiveThread(
  api: PublicApiClient,
  threadId: string,
): Promise<void> {
  const response = await api.threads[":id"]["archive-all"].$post({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `archive thread ${threadId}`);
}

export async function createProject(
  api: PublicApiClient,
  request: CreateProjectRequest,
): Promise<ProjectResponse> {
  const response = await api.projects.$post({
    json: request,
  });
  await expectStatus(response, 201, `create project ${request.name}`);
  return projectResponseSchema.parse(await response.json());
}

async function postThread(
  api: PublicApiClient,
  environment: CreateThreadRequest["environment"],
  options: CreateHostThreadOptions | CreateReuseThreadOptions,
  label: string,
): Promise<Thread> {
  const providerId = options.providerId ?? "fake";
  const { model, ...execution } = options.execution ?? {};
  const response = await api.threads.$post({
    json: {
      environment,
      input: options.input ?? defaultThreadInput(DEFAULT_THREAD_BOOTSTRAP_TEXT),
      origin: DEFAULT_PUBLIC_TEST_THREAD_ORIGIN,
      ...execution,
      model: model ?? defaultModelForProvider(providerId),
      parentThreadId: options.parentThreadId,
      projectId: options.projectId,
      providerId,
      title: options.title,
      startedOnBehalfOf: null,
      originKind: null,
    },
  });
  await expectStatus(response, 201, label);
  return threadSchema.parse(await response.json());
}

export async function createHostThread(
  api: PublicApiClient,
  options: CreateHostThreadOptions,
): Promise<Thread> {
  return postThread(
    api,
    {
      type: "host",
      hostId: options.hostId,
      workspace: toWorkspaceArgs(options.workspace),
    },
    options,
    "create host thread",
  );
}

export async function createReuseThread(
  api: PublicApiClient,
  options: CreateReuseThreadOptions,
): Promise<Thread> {
  return postThread(
    api,
    {
      type: "reuse",
      environmentId: options.environmentId,
    },
    options,
    "create reuse thread",
  );
}

export async function deleteThread(
  api: PublicApiClient,
  threadId: string,
): Promise<void> {
  const response = await api.threads[":id"].$delete({
    param: { id: threadId },
    json: { childThreadsConfirmed: false },
  });
  await expectStatus(response, 200, `delete thread ${threadId}`);
}

export async function getEnvironment(
  api: PublicApiClient,
  environmentId: string,
): Promise<Environment> {
  const response = await api.environments[":id"].$get({
    param: { id: environmentId },
  });
  await expectStatus(response, 200, `get environment ${environmentId}`);
  return environmentSchema.parse(await response.json());
}

async function readGitRpc<T>(
  api: PublicApiClient,
  environmentId: string,
  method: string,
  input: Record<string, unknown>,
  output: z.ZodType<T>,
): Promise<T> {
  const origin = api.environments[":id"].$url({
    param: { id: environmentId },
  }).origin;
  const response = await fetch(
    `${origin}/api/v1/plugins/bb--git/rpc/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  await expectStatus(response, 200, `Git ${method} ${environmentId}`);
  return z
    .object({ ok: z.literal(true), result: output })
    .parse(await response.json()).result;
}

export function getGitBranches(api: PublicApiClient, environmentId: string) {
  return readGitRpc(
    api,
    environmentId,
    "branches",
    { environmentId, query: "", selectedBranch: null, limit: 100 },
    gitRpcContract.branches.output,
  );
}

export async function getGitDiff(
  api: PublicApiClient,
  environmentId: string,
): Promise<ThreadGitDiffResponse> {
  const mergeBaseBranch = await requireMergeBaseBranch(api, environmentId);
  const result = await readGitRpc(
    api,
    environmentId,
    "diff",
    {
      environmentId,
      target: { type: "all", mergeBaseBranch },
      purpose: "display",
    },
    environmentDiffResponseSchema,
  );
  if (result.outcome === "available") return result.diff;
  throw new Error(
    result.outcome === "unavailable" ? result.failure.message : result.message,
  );
}

export function getGitDiffFiles(api: PublicApiClient, environmentId: string) {
  return readGitRpc(
    api,
    environmentId,
    "files",
    { environmentId, target: { type: "uncommitted" }, ignoreWhitespace: false },
    environmentDiffFilesResponseSchema,
  );
}

export async function getGitDiffPatch(
  api: PublicApiClient,
  environmentId: string,
  paths: string[],
) {
  const keys = paths.map((path) =>
    JSON.stringify({
      environmentId,
      target: { type: "uncommitted" },
      path,
      ignoreWhitespace: false,
    }),
  );
  const result = await readGitRpc(
    api,
    environmentId,
    "patches",
    { keys },
    gitRpcContract.patches.output,
  );
  return Object.values(result);
}

export async function getGitStatus(
  api: PublicApiClient,
  environmentId: string,
) {
  const mergeBaseBranch = await requireMergeBaseBranch(api, environmentId);
  return readGitRpc(
    api,
    environmentId,
    "status",
    { environmentId, mergeBaseBranch },
    environmentStatusResponseSchema,
  );
}

export async function getAvailableModels(
  api: PublicApiClient,
  options: GetAvailableModelsOptions,
): Promise<AvailableModel[]> {
  const response = await api.system["execution-options"].$get({
    query: {
      ...(options.hostId ? { hostId: options.hostId } : {}),
      ...(options.providerId ? { providerId: options.providerId } : {}),
    },
  });
  await expectStatus(response, 200, "get available models");
  return systemExecutionOptionsResponseSchema.parse(await response.json())
    .models;
}

export async function getHosts(api: PublicApiClient): Promise<Host[]> {
  const response = await api.hosts.$get({});
  await expectStatus(response, 200, "get hosts");
  return hostSchema.array().parse(await response.json());
}

export async function getThread(
  api: PublicApiClient,
  threadId: string,
): Promise<Thread> {
  const response = await api.threads[":id"].$get({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `get thread ${threadId}`);
  return threadSchema.parse(await response.json());
}

export async function getThreadResponse(
  api: PublicApiClient,
  threadId: string,
): Promise<ThreadResponse> {
  const response = await api.threads[":id"].$get({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `get thread ${threadId}`);
  return threadResponseSchema.parse(await response.json());
}

export async function getThreadEvents(
  api: PublicApiClient,
  threadId: string,
): Promise<ThreadEventRow[]> {
  const rows: ThreadEventRow[] = [];
  let afterSeq: string | undefined;
  for (;;) {
    const response = await api.threads[":id"].events.$get({
      param: { id: threadId },
      query: {
        ...(afterSeq === undefined ? {} : { afterSeq }),
        limit: String(THREAD_EVENT_LIST_PAGE_SIZE),
        order: "asc",
      },
    });
    await expectStatus(response, 200, `get thread events ${threadId}`);
    const page = threadEventRowSchema.array().parse(await response.json());
    rows.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < THREAD_EVENT_LIST_PAGE_SIZE) {
      return rows;
    }
    afterSeq = String(last.seq);
  }
}

export async function getThreadOutput(
  api: PublicApiClient,
  threadId: string,
): Promise<string | null> {
  const response = await api.threads[":id"].output.$get({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `get thread output ${threadId}`);
  const payload = await response.json();
  return payload.output;
}

export async function getThreadTimeline(
  api: PublicApiClient,
  threadId: string,
  options: GetThreadTimelineOptions = {},
): Promise<ThreadTimelineResponse> {
  const response = await api.threads[":id"].timeline.$get({
    param: { id: threadId },
    query:
      options.includeNestedRows === undefined
        ? {}
        : { includeNestedRows: options.includeNestedRows ? "true" : "false" },
  });
  await expectStatus(response, 200, `get thread timeline ${threadId}`);
  return threadTimelineResponseSchema.parse(await response.json());
}

export async function listThreadInteractions(
  api: PublicApiClient,
  threadId: string,
): Promise<ThreadPendingInteractionsResponse> {
  const response = await api.threads[":id"].interactions.$get({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `list thread interactions ${threadId}`);
  return threadPendingInteractionsResponseSchema.parse(await response.json());
}

export async function resolveThreadInteraction(
  args: ResolveThreadInteractionArgs,
): Promise<PendingInteraction> {
  const response = await args.api.threads[":id"].interactions[
    ":interactionId"
  ].resolve.$post({
    param: { id: args.threadId, interactionId: args.interactionId },
    json: args.resolution,
  });
  await expectStatus(
    response,
    200,
    `resolve thread interaction ${args.interactionId}`,
  );
  return pendingInteractionSchema.parse(await response.json());
}

export async function runEnvironmentAction(
  api: PublicApiClient,
  environmentId: string,
  request: EnvironmentActionRequest,
): Promise<EnvironmentActionResponse> {
  const response = await api.environments[":id"].actions.$post({
    param: { id: environmentId },
    json: request,
  });
  await expectStatus(response, 200, `run environment action ${request.action}`);
  return environmentActionResponseSchema.parse(await response.json());
}

export async function sendTextMessage(
  api: PublicApiClient,
  threadId: string,
  options: SendTextMessageOptions,
): Promise<void> {
  const request: SendMessageRequest = {
    input: [{ type: "text", text: options.text, mentions: [] }],
    mode: options.mode ?? "auto",
    ...(options.execution ?? {}),
  };
  const response = await api.threads[":id"].send.$post({
    param: { id: threadId },
    json: request,
  });
  await expectStatus(response, 200, `send message to thread ${threadId}`);
}

export async function stopThread(
  api: PublicApiClient,
  threadId: string,
): Promise<void> {
  const response = await api.threads[":id"].stop.$post({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `stop thread ${threadId}`);
}

export async function unarchiveThread(
  api: PublicApiClient,
  threadId: string,
): Promise<void> {
  const response = await api.threads[":id"].unarchive.$post({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `unarchive thread ${threadId}`);
}

export async function restoreThreadEnvironment(
  api: PublicApiClient,
  threadId: string,
): Promise<void> {
  const response = await api.threads[":id"]["restore-environment"].$post({
    param: { id: threadId },
  });
  await expectStatus(response, 200, `restore thread ${threadId} environment`);
}

export async function updateThread(
  api: PublicApiClient,
  threadId: string,
  request: UpdateThreadRequest,
): Promise<Thread> {
  const response = await api.threads[":id"].$patch({
    param: { id: threadId },
    json: request,
  });
  await expectStatus(response, 200, `update thread ${threadId}`);
  return threadSchema.parse(await response.json());
}
