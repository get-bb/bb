import { extractErrorMessage, toRecord } from "@bb/core-ui";
import type {
  Environment,
  Experiments,
  Host,
  PendingInteraction,
  ProjectExecutionDefaults,
  ProjectSource,
  ResolvedThreadExecutionOptions,
  ThreadEventRow,
  ThreadQueuedMessage,
  WorkspaceDiffTarget,
} from "@bb/domain";
import type {
  AutomationsOverviewResponse,
  CreateProjectSourceRequest,
  CreateProjectRequest,
  CreateQueuedMessageRequest,
  DeleteThreadRequest,
  EnvironmentArchiveThreadsResponse,
  EnvironmentActionRequest,
  EnvironmentActionResponse,
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffResponse,
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
  EnvironmentStatusResponse,
  CreateThreadRequest,
  CreateThreadTerminalRequest,
  ProjectBranchesResponse,
  ProjectResponse,
  SidebarBootstrapResponse,
  PromptHistoryResponse,
  ReorderPinnedThreadRequest,
  ReorderProjectRequest,
  ReorderQueuedMessageRequest,
  SendQueuedMessageRequest,
  SendQueuedMessageResponse,
  SendMessageRequest,
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
  SystemProviderInfo,
  SystemVersionResponse,
  TimelinePaginationCursor,
  SystemVoiceTranscriptionResponse,
  ThreadArchiveAllResponse,
  ThreadChildSummaryResponse,
  ThreadComposerBootstrapResponse,
  ThreadPendingInteractionsResponse,
  ThreadQueuedMessageListResponse,
  ThreadListResponse,
  ThreadResponse,
  ThreadSchedule,
  ThreadWithIncludesResponse,
  PathListIncludeQueryValue,
  BranchListQuery,
  EnvironmentDiffBranchesQuery,
  ProjectBranchesQuery,
  ThreadStorageFilesQuery,
  ThreadStoragePathsQuery,
  TerminalSession,
  ThreadTerminalListResponse,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsRequest,
  TimelineTurnSummaryDetailsResponse,
  CloseThreadTerminalRequest,
  ResolvePendingInteractionRequest,
  UpdateEnvironmentRequest,
  UpdateProjectRequest,
  UpdateThreadRequest,
  UpdateThreadTerminalRequest,
  UpdateProjectSourceRequest,
  UploadedPromptAttachment,
  ThreadStorageFileListResponse,
  ThreadStoragePathListResponse,
  WorkspacePathListResponse,
  ReplayCaptureListResponse,
  ReplayRunRequest,
  ReplayRunResponse,
  AddAppSourceRequest,
  AppDetail,
  AppSourceStatus,
  AppSummary,
  CreateWorkflowRunRequest,
  WorkflowListResponse,
  WorkflowRunEventsResponse,
  WorkflowRunListQuery,
  WorkflowRunListResponse,
  WorkflowRunResponse,
} from "@bb/server-contract";
import { apiClient, toRelativeUrl } from "./api-server";
import {
  buildFilePreview,
  normalizeFilePreviewMimeType,
  type EnvironmentFilePreviewSource,
  type FilePreview,
  type FilePreviewTarget,
} from "./file-preview";
import {
  buildAppPublicFileUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageContentUrl,
} from "./file-content-urls";
import type { ThreadStorageFileListOptions } from "./thread-storage-files";
import type { PathListOptions } from "./path-list-options";
export type { FilePreview } from "./file-preview";

interface GetThreadTimelineArgs {
  beforeCursor?: TimelinePaginationCursor;
  id: string;
  includeNestedRows?: boolean;
  segmentLimit?: number;
}

interface GetThreadTimelineTurnSummaryDetailsArgs extends TimelineTurnSummaryDetailsRequest {
  id: string;
}

interface GetEnvironmentFilePreviewArgs {
  id: string;
  path: string;
  source: EnvironmentFilePreviewSource;
  signal?: AbortSignal;
}

export interface BranchListRequest {
  query?: string;
  limit?: number;
}

export interface EnvironmentBranchListRequest extends BranchListRequest {
  selectedBranch?: string;
}

export type ProjectBranchListRequest = EnvironmentBranchListRequest;

export type AppCreateThreadRequest = Omit<CreateThreadRequest, "origin">;

export interface GetProjectDefaultExecutionOptionsRequest {
  projectId: string;
}

const HTML_DOCUMENT_PATTERN = /<!doctype html|<html[\s>]/i;
const ERROR_EXTRACT_OPTS = {
  legacyKeys: ["detail"] as const,
};

function normalizeErrorText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function requestOptions(signal?: AbortSignal) {
  return signal ? { init: { signal } } : undefined;
}

function buildBranchListQuery(
  args: BranchListRequest | undefined,
): BranchListQuery {
  return {
    ...(args?.query ? { query: args.query } : {}),
    ...(args?.limit !== undefined ? { limit: String(args.limit) } : {}),
  };
}

function buildProjectBranchesQuery(
  hostId: string,
  args: ProjectBranchListRequest | undefined,
): ProjectBranchesQuery {
  return {
    hostId,
    ...buildBranchListQuery(args),
    ...(args?.selectedBranch ? { selectedBranch: args.selectedBranch } : {}),
  };
}

function buildEnvironmentDiffBranchesQuery(
  args: EnvironmentBranchListRequest | undefined,
): EnvironmentDiffBranchesQuery {
  return {
    ...buildBranchListQuery(args),
    ...(args?.selectedBranch ? { selectedBranch: args.selectedBranch } : {}),
  };
}

export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(args: {
    status: number;
    message: string;
    code?: string;
    body?: unknown;
  }) {
    super(`HTTP ${args.status}: ${args.message}`);
    this.name = "HttpError";
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
  }
}

function deriveHttpErrorMessage(
  status: number,
  statusText: string,
  rawBody: string,
  contentType: string | null,
): string {
  const normalized = normalizeErrorText(rawBody);
  if (normalized.length === 0) {
    return statusText || "Request failed";
  }

  const shouldParseAsJson =
    (contentType?.includes("application/json") ?? false) ||
    normalized.startsWith("{") ||
    normalized.startsWith("[");
  if (shouldParseAsJson) {
    try {
      const parsed = JSON.parse(normalized) as unknown;
      const message = extractErrorMessage(parsed, ERROR_EXTRACT_OPTS);
      if (message) {
        return message;
      }
    } catch {
      // Fall through to non-JSON handling.
    }
  }

  if (HTML_DOCUMENT_PATTERN.test(normalized)) {
    if (status === 401 || status === 403) {
      return "Authentication failed";
    }
    return statusText || "Request failed";
  }

  return (
    (extractErrorMessage(normalized, ERROR_EXTRACT_OPTS) ?? statusText) ||
    "Request failed"
  );
}

function parseHttpErrorBody(
  rawBody: string,
  contentType: string | null,
): unknown | undefined {
  const normalized = normalizeErrorText(rawBody);
  if (normalized.length === 0) {
    return undefined;
  }

  const shouldParseAsJson =
    (contentType?.includes("application/json") ?? false) ||
    normalized.startsWith("{") ||
    normalized.startsWith("[");
  if (!shouldParseAsJson) {
    return undefined;
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return undefined;
  }
}

function extractErrorCode(value: unknown): string | undefined {
  const record = toRecord(value);
  if (!record) {
    return undefined;
  }
  return typeof record.code === "string" && record.code.trim().length > 0
    ? record.code
    : undefined;
}

async function throwHttpError(res: Response): Promise<never> {
  const rawBody = await res.text().catch(() => "");
  const contentType = res.headers.get("content-type");
  const message = deriveHttpErrorMessage(
    res.status,
    res.statusText,
    rawBody,
    contentType,
  );
  const body = parseHttpErrorBody(rawBody, contentType);
  throw new HttpError({
    status: res.status,
    message,
    code: extractErrorCode(body),
    body,
  });
}

async function request<T>(responsePromise: Promise<Response>): Promise<T> {
  const res = await requestResponse(responsePromise);
  const text = await res.text();
  return JSON.parse(text) as T;
}

async function requestVoid(responsePromise: Promise<Response>): Promise<void> {
  await requestResponse(responsePromise);
}

async function requestResponse(
  responsePromise: Promise<Response>,
): Promise<Response> {
  const res = await responsePromise;
  if (!res.ok) {
    await throwHttpError(res);
  }
  return res;
}

export async function loadFilePreview(
  target: FilePreviewTarget,
  signal?: AbortSignal,
): Promise<FilePreview> {
  const response = await requestResponse(
    fetch(target.url, {
      method: "GET",
      signal,
    }),
  );
  const contentBytes = new Uint8Array(await response.arrayBuffer());
  return buildFilePreview({
    contentBytes,
    mimeType: normalizeFilePreviewMimeType(
      response.headers.get("content-type"),
    ),
    name: target.name,
    path: target.path,
    url: target.url,
  });
}

function decodeBase64Bytes(content: string): Uint8Array {
  const binaryContent = atob(content);
  const bytes = new Uint8Array(binaryContent.length);
  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const binaryChunks: string[] = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binaryChunks.push(
      String.fromCharCode(...bytes.subarray(index, index + chunkSize)),
    );
  }
  return btoa(binaryChunks.join(""));
}

function decodeEnvironmentDiffFileContent(
  response: EnvironmentDiffFileResponse,
): Uint8Array {
  if (response.contentEncoding === "base64") {
    return decodeBase64Bytes(response.content);
  }

  return new TextEncoder().encode(response.content);
}

function buildEnvironmentDiffFilePreviewUrl(
  response: EnvironmentDiffFileResponse,
  contentBytes: Uint8Array,
  mimeType: string,
): string {
  const base64Content =
    response.contentEncoding === "base64"
      ? response.content
      : encodeBase64Bytes(contentBytes);
  return `data:${mimeType};base64,${base64Content}`;
}

interface BuildEnvironmentFilePreviewQueryArgs {
  path: string;
  source: EnvironmentFilePreviewSource;
}

function buildEnvironmentFilePreviewQuery({
  path,
  source,
}: BuildEnvironmentFilePreviewQueryArgs): EnvironmentDiffFileQuery {
  switch (source.kind) {
    case "working-tree":
      return {
        target: "uncommitted",
        path,
        side: "new",
      };
    case "head":
      return {
        target: "uncommitted",
        path,
        side: "old",
      };
    case "merge-base":
      return {
        target: "branch_committed",
        mergeBaseRef: source.ref,
        path,
        side: "old",
      };
  }
}

/**
 * The app previews workspace files by using the diff-file route. Current files
 * read the uncommitted new side from disk; deleted-file previews read the old
 * side from HEAD or the merge base because the working-tree path is gone.
 */
export async function getEnvironmentFilePreview({
  id,
  path,
  source,
  signal,
}: GetEnvironmentFilePreviewArgs): Promise<FilePreview> {
  const query = buildEnvironmentFilePreviewQuery({ path, source });
  const response = await request<EnvironmentDiffFileResponse>(
    apiClient.environments[":id"].diff.file.$get(
      {
        param: { id },
        query,
      },
      requestOptions(signal),
    ),
  );
  const contentBytes = decodeEnvironmentDiffFileContent(response);
  const mimeType = normalizeFilePreviewMimeType(response.mimeType ?? null);
  return buildFilePreview({
    contentBytes,
    mimeType,
    name: path.split("/").at(-1),
    path,
    url: buildEnvironmentDiffFilePreviewUrl(response, contentBytes, mimeType),
  });
}

async function postMultipart<T>(
  url: URL,
  file: File,
  signal?: AbortSignal,
  fields?: Record<string, string>,
): Promise<T> {
  const formData = new FormData();
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }
  }
  formData.set("file", file, file.name);

  const res = await fetch(toRelativeUrl(url), {
    method: "POST",
    body: formData,
    signal,
  });
  if (!res.ok) {
    await throwHttpError(res);
  }
  const text = await res.text();
  return JSON.parse(text) as T;
}

export async function listReplayCaptures(): Promise<ReplayCaptureListResponse> {
  return request<ReplayCaptureListResponse>(
    apiClient["development-only"].replay.captures.$get(),
  );
}

export async function startReplayRun(
  id: string,
  req: ReplayRunRequest,
): Promise<ReplayRunResponse> {
  return request<ReplayRunResponse>(
    apiClient["development-only"].replay.captures[":id"].runs.$post({
      param: { id },
      json: req,
    }),
  );
}

export async function deleteReplayCapture(id: string): Promise<void> {
  await requestVoid(
    apiClient["development-only"].replay.captures[":id"].$delete({
      param: { id },
    }),
  );
}

export async function createProject(
  req: CreateProjectRequest,
): Promise<ProjectResponse> {
  return request<ProjectResponse>(apiClient.projects.$post({ json: req }));
}

export async function updateProject(
  id: string,
  req: UpdateProjectRequest,
): Promise<ProjectResponse> {
  return request<ProjectResponse>(
    apiClient.projects[":id"].$patch({ param: { id }, json: req }),
  );
}

export async function reorderProject(
  id: string,
  req: ReorderProjectRequest,
): Promise<ProjectResponse[]> {
  return request<ProjectResponse[]>(
    apiClient.projects[":id"].order.$patch({ param: { id }, json: req }),
  );
}

export async function listProjectsWithThreads(
  signal?: AbortSignal,
): Promise<SidebarBootstrapResponse> {
  return request<SidebarBootstrapResponse>(
    apiClient["sidebar-bootstrap"].$get(undefined, requestOptions(signal)),
  );
}

export async function listAutomationsOverview(
  signal?: AbortSignal,
): Promise<AutomationsOverviewResponse> {
  return request<AutomationsOverviewResponse>(
    apiClient.automations.$get(undefined, requestOptions(signal)),
  );
}

export async function listProjectPromptHistory(
  projectId: string,
  signal?: AbortSignal,
): Promise<PromptHistoryResponse> {
  return request<PromptHistoryResponse>(
    apiClient.projects[":id"]["prompt-history"].$get(
      { param: { id: projectId } },
      requestOptions(signal),
    ),
  );
}

export async function getProjectDefaultExecutionOptions(
  args: GetProjectDefaultExecutionOptionsRequest,
): Promise<ProjectExecutionDefaults | null> {
  return request<ProjectExecutionDefaults | null>(
    apiClient.projects[":id"]["default-execution-options"].$get({
      param: { id: args.projectId },
      query: {},
    }),
  );
}

export async function deleteProject(id: string): Promise<void> {
  await requestVoid(apiClient.projects[":id"].$delete({ param: { id } }));
}

export async function addProjectSource(
  projectId: string,
  req: CreateProjectSourceRequest,
): Promise<ProjectSource> {
  return request<ProjectSource>(
    apiClient.projects[":id"].sources.$post({
      param: { id: projectId },
      json: req,
    }),
  );
}

export async function updateProjectSource(
  projectId: string,
  sourceId: string,
  req: UpdateProjectSourceRequest,
): Promise<ProjectSource> {
  return request<ProjectSource>(
    apiClient.projects[":id"].sources[":sourceId"].$patch({
      param: { id: projectId, sourceId },
      json: req,
    }),
  );
}

export async function removeProjectSource(
  projectId: string,
  sourceId: string,
): Promise<void> {
  await requestVoid(
    apiClient.projects[":id"].sources[":sourceId"].$delete({
      param: { id: projectId, sourceId },
    }),
  );
}

interface SearchProjectPathsArgs {
  projectId: string;
  query: string;
  limit: number;
  environmentId: string | null;
  includeFiles: boolean;
  includeDirectories: boolean;
}

function toPathListIncludeQueryValue(
  value: boolean,
): PathListIncludeQueryValue {
  return value ? "true" : "false";
}

export async function searchProjectPaths(
  args: SearchProjectPathsArgs,
): Promise<WorkspacePathListResponse> {
  return request<WorkspacePathListResponse>(
    apiClient.projects[":id"].paths.$get({
      param: { id: args.projectId },
      query: {
        query: args.query,
        limit: String(args.limit),
        environmentId: args.environmentId ?? "",
        includeFiles: toPathListIncludeQueryValue(args.includeFiles),
        includeDirectories: toPathListIncludeQueryValue(
          args.includeDirectories,
        ),
      },
    }),
  );
}

export async function getProjectSourceBranches(
  projectId: string,
  hostId: string,
  args?: ProjectBranchListRequest,
): Promise<ProjectBranchesResponse> {
  return request<ProjectBranchesResponse>(
    apiClient.projects[":id"].branches.$get({
      param: { id: projectId },
      query: buildProjectBranchesQuery(hostId, args),
    }),
  );
}

export async function uploadPromptAttachment(
  projectId: string,
  file: File,
): Promise<UploadedPromptAttachment> {
  return postMultipart<UploadedPromptAttachment>(
    apiClient.projects[":id"].attachments.$url({ param: { id: projectId } }),
    file,
  );
}

export async function transcribeVoiceInput(
  file: File,
  prompt?: string,
  signal?: AbortSignal,
): Promise<SystemVoiceTranscriptionResponse> {
  const trimmedPrompt = prompt?.trim();
  return postMultipart<SystemVoiceTranscriptionResponse>(
    apiClient.system["voice-transcription"].$url(),
    file,
    signal,
    trimmedPrompt ? { prompt: trimmedPrompt } : undefined,
  );
}

export async function createThread(
  req: AppCreateThreadRequest,
): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads.$post({
      json: {
        ...req,
        origin: "app",
      },
    }),
  );
}

export interface ThreadListFilters {
  projectId?: string;
  parentThreadId?: string;
  hasParent?: boolean;
  /** App callers must choose active or archived; server omission intentionally means both. */
  archived: boolean;
  limit?: number;
  offset?: number;
}

function toBooleanQueryValue(value: boolean): "true" | "false" {
  return value ? "true" : "false";
}

export async function listThreads(
  filters: ThreadListFilters,
  signal?: AbortSignal,
): Promise<ThreadListResponse> {
  return request<ThreadListResponse>(
    apiClient.threads.$get(
      {
        query: {
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.parentThreadId
            ? { parentThreadId: filters.parentThreadId }
            : {}),
          ...(filters.hasParent !== undefined
            ? { hasParent: toBooleanQueryValue(filters.hasParent) }
            : {}),
          archived: toBooleanQueryValue(filters.archived),
          ...(filters.limit !== undefined
            ? { limit: String(filters.limit) }
            : {}),
          ...(filters.offset !== undefined
            ? { offset: String(filters.offset) }
            : {}),
        },
      },
      requestOptions(signal),
    ),
  );
}

export async function getThread(id: string): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads[":id"].$get({ param: { id } }),
  );
}

export async function pinThread(id: string): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads[":id"].pin.$post({ param: { id } }),
  );
}

export async function unpinThread(id: string): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads[":id"].unpin.$post({ param: { id } }),
  );
}

export async function reorderPinnedThread(
  id: string,
  req: ReorderPinnedThreadRequest,
): Promise<ThreadListResponse> {
  return request<ThreadListResponse>(
    apiClient.threads[":id"]["pin-order"].$patch({
      param: { id },
      json: req,
    }),
  );
}

export async function getThreadWithEnvironmentHost(
  id: string,
  signal?: AbortSignal,
): Promise<ThreadWithIncludesResponse> {
  return request<ThreadWithIncludesResponse>(
    apiClient.threads[":id"].$get(
      {
        param: { id },
        query: { include: "environment,host" },
      },
      requestOptions(signal),
    ),
  );
}

export async function getThreadChildSummary(
  id: string,
  signal?: AbortSignal,
): Promise<ThreadChildSummaryResponse> {
  return request<ThreadChildSummaryResponse>(
    apiClient.threads[":id"]["child-summary"].$get(
      { param: { id } },
      requestOptions(signal),
    ),
  );
}

export async function listThreadSchedules(
  id: string,
  signal?: AbortSignal,
): Promise<ThreadSchedule[]> {
  return request<ThreadSchedule[]>(
    apiClient.threads[":id"].schedules.$get(
      { param: { id } },
      requestOptions(signal),
    ),
  );
}

interface ListThreadStorageFilesArgs {
  id: string;
  options: ThreadStorageFileListOptions;
  signal?: AbortSignal;
}

function toThreadStorageFilesQuery(
  options: ThreadStorageFileListOptions,
): ThreadStorageFilesQuery {
  const trimmedQuery = options.query?.trim() ?? "";
  return {
    ...(trimmedQuery.length > 0 ? { query: trimmedQuery } : {}),
    limit: String(options.limit),
  };
}

export async function listThreadStorageFiles({
  id,
  options,
  signal,
}: ListThreadStorageFilesArgs): Promise<ThreadStorageFileListResponse> {
  return request<ThreadStorageFileListResponse>(
    apiClient.threads[":id"]["thread-storage"].files.$get(
      {
        param: { id },
        query: toThreadStorageFilesQuery(options),
      },
      requestOptions(signal),
    ),
  );
}

interface ListThreadStoragePathsArgs {
  id: string;
  options: PathListOptions;
  signal?: AbortSignal;
}

function toThreadStoragePathsQuery(
  options: PathListOptions,
): ThreadStoragePathsQuery {
  const trimmedQuery = options.query?.trim() ?? "";
  return {
    ...(trimmedQuery.length > 0 ? { query: trimmedQuery } : {}),
    limit: String(options.limit),
    includeFiles: toPathListIncludeQueryValue(options.includeFiles),
    includeDirectories: toPathListIncludeQueryValue(options.includeDirectories),
  };
}

export async function listThreadStoragePaths({
  id,
  options,
  signal,
}: ListThreadStoragePathsArgs): Promise<ThreadStoragePathListResponse> {
  return request<ThreadStoragePathListResponse>(
    apiClient.threads[":id"]["thread-storage"].paths.$get(
      {
        param: { id },
        query: toThreadStoragePathsQuery(options),
      },
      requestOptions(signal),
    ),
  );
}

export async function getThreadStorageFilePreview(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<FilePreview> {
  return loadFilePreview(
    {
      path,
      url: buildThreadStorageContentUrl(id, path),
    },
    signal,
  );
}

export async function listApps(signal?: AbortSignal): Promise<AppSummary[]> {
  return request<AppSummary[]>(apiClient.apps.$get({}, requestOptions(signal)));
}

export async function listAppSources(
  signal?: AbortSignal,
): Promise<AppSourceStatus[]> {
  return request<AppSourceStatus[]>(
    apiClient["app-sources"].$get({}, requestOptions(signal)),
  );
}

export async function addAppSource(
  req: AddAppSourceRequest,
): Promise<AppSourceStatus> {
  return request<AppSourceStatus>(
    apiClient["app-sources"].$post({ json: req }),
  );
}

export async function syncAppSource(
  name: string,
  force: boolean,
): Promise<AppSourceStatus> {
  return request<AppSourceStatus>(
    apiClient["app-sources"][":name"].sync.$post({
      param: { name },
      json: { force },
    }),
  );
}

export async function removeAppSource(name: string): Promise<void> {
  await requestVoid(
    apiClient["app-sources"][":name"].$delete({ param: { name } }),
  );
}

export async function getApp(
  applicationId: string,
  signal?: AbortSignal,
): Promise<AppDetail> {
  return request<AppDetail>(
    apiClient.apps[":applicationId"].$get(
      { param: { applicationId } },
      requestOptions(signal),
    ),
  );
}

export async function getAppMarkdownPreview(
  applicationId: string,
  path: string,
  signal?: AbortSignal,
): Promise<FilePreview> {
  return loadFilePreview(
    {
      name: path.split("/").at(-1),
      path,
      url: buildAppPublicFileUrl(applicationId, path),
    },
    signal,
  );
}

export async function getThreadHostFilePreview(
  id: string,
  path: string,
  signal?: AbortSignal,
): Promise<FilePreview> {
  return loadFilePreview(
    {
      name: path.split("/").at(-1),
      path,
      url: buildThreadHostFileContentUrl(id, path),
    },
    signal,
  );
}

export async function updateThread(
  id: string,
  req: UpdateThreadRequest,
): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads[":id"].$patch({ param: { id }, json: req }),
  );
}

export async function getThreadDefaultExecutionOptions(
  id: string,
): Promise<ResolvedThreadExecutionOptions | null> {
  return request<ResolvedThreadExecutionOptions | null>(
    apiClient.threads[":id"]["default-execution-options"].$get({
      param: { id },
    }),
  );
}

export async function listThreadTerminals(
  id: string,
  signal?: AbortSignal,
): Promise<ThreadTerminalListResponse> {
  return request<ThreadTerminalListResponse>(
    apiClient.threads[":id"].terminals.$get(
      { param: { id } },
      requestOptions(signal),
    ),
  );
}

export async function createThreadTerminal(
  id: string,
  req: CreateThreadTerminalRequest,
): Promise<TerminalSession> {
  return request<TerminalSession>(
    apiClient.threads[":id"].terminals.$post({
      param: { id },
      json: req,
    }),
  );
}

export async function renameThreadTerminal(
  id: string,
  terminalId: string,
  req: UpdateThreadTerminalRequest,
): Promise<TerminalSession> {
  return request<TerminalSession>(
    apiClient.threads[":id"].terminals[":terminalId"].$patch({
      param: { id, terminalId },
      json: req,
    }),
  );
}

export async function closeThreadTerminal(
  id: string,
  terminalId: string,
  req: CloseThreadTerminalRequest,
): Promise<TerminalSession> {
  return request<TerminalSession>(
    apiClient.threads[":id"].terminals[":terminalId"].close.$post({
      param: { id, terminalId },
      json: req,
    }),
  );
}

export async function sendThreadMessage(
  id: string,
  req: SendMessageRequest,
): Promise<void> {
  await requestVoid(
    apiClient.threads[":id"].send.$post({ param: { id }, json: req }),
  );
}

export async function createThreadQueuedMessage(
  id: string,
  req: CreateQueuedMessageRequest,
): Promise<ThreadQueuedMessage> {
  return request<ThreadQueuedMessage>(
    apiClient.threads[":id"]["queued-messages"].$post({
      param: { id },
      json: req,
    }),
  );
}

export async function getThreadComposerBootstrap(
  id: string,
): Promise<ThreadComposerBootstrapResponse> {
  return request<ThreadComposerBootstrapResponse>(
    apiClient.threads[":id"]["composer-bootstrap"].$get({ param: { id } }),
  );
}

export async function listThreadQueuedMessages(
  id: string,
): Promise<ThreadQueuedMessageListResponse> {
  return request<ThreadQueuedMessageListResponse>(
    apiClient.threads[":id"]["queued-messages"].$get({ param: { id } }),
  );
}

export async function listThreadPromptHistory(
  id: string,
  signal?: AbortSignal,
): Promise<PromptHistoryResponse> {
  return request<PromptHistoryResponse>(
    apiClient.threads[":id"]["prompt-history"].$get(
      { param: { id } },
      requestOptions(signal),
    ),
  );
}

export async function sendThreadQueuedMessage(
  id: string,
  queuedMessageId: string,
  req: SendQueuedMessageRequest,
): Promise<SendQueuedMessageResponse> {
  return request<SendQueuedMessageResponse>(
    apiClient.threads[":id"]["queued-messages"][":queuedMessageId"].send.$post({
      param: { id, queuedMessageId },
      json: req,
    }),
  );
}

export async function reorderThreadQueuedMessage(
  id: string,
  queuedMessageId: string,
  req: ReorderQueuedMessageRequest,
): Promise<ThreadQueuedMessageListResponse> {
  return request<ThreadQueuedMessageListResponse>(
    apiClient.threads[":id"]["queued-messages"][
      ":queuedMessageId"
    ].order.$patch({
      param: { id, queuedMessageId },
      json: req,
    }),
  );
}

export async function deleteThreadQueuedMessage(
  id: string,
  queuedMessageId: string,
): Promise<void> {
  await requestVoid(
    apiClient.threads[":id"]["queued-messages"][":queuedMessageId"].$delete({
      param: { id, queuedMessageId },
    }),
  );
}

export async function stopThread(id: string): Promise<void> {
  await requestVoid(apiClient.threads[":id"].stop.$post({ param: { id } }));
}

export async function listThreadPendingInteractions(
  id: string,
  signal?: AbortSignal,
): Promise<ThreadPendingInteractionsResponse> {
  return request<ThreadPendingInteractionsResponse>(
    apiClient.threads[":id"].interactions.$get(
      { param: { id } },
      requestOptions(signal),
    ),
  );
}

export async function resolveThreadPendingInteraction(
  threadId: string,
  interactionId: string,
  req: ResolvePendingInteractionRequest,
): Promise<PendingInteraction> {
  return request<PendingInteraction>(
    apiClient.threads[":id"].interactions[":interactionId"].resolve.$post({
      param: { id: threadId, interactionId },
      json: req,
    }),
  );
}

export async function archiveThread(id: string): Promise<void> {
  await requestVoid(
    apiClient.threads[":id"].archive.$post({
      param: { id },
    }),
  );
}

export async function archiveThreadAndChildren(
  id: string,
): Promise<ThreadArchiveAllResponse> {
  return request<ThreadArchiveAllResponse>(
    apiClient.threads[":id"]["archive-all"].$post({ param: { id } }),
  );
}

export async function unarchiveThread(id: string): Promise<void> {
  await requestVoid(
    apiClient.threads[":id"].unarchive.$post({ param: { id } }),
  );
}

export async function deleteThread(
  id: string,
  opts: DeleteThreadRequest,
): Promise<void> {
  await requestVoid(
    apiClient.threads[":id"].$delete({ param: { id }, json: opts }),
  );
}

export async function markThreadRead(id: string): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads[":id"].read.$post({ param: { id } }),
  );
}

export async function markThreadUnread(id: string): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads[":id"].unread.$post({ param: { id } }),
  );
}

export async function getHost(
  id: string,
  signal?: AbortSignal,
): Promise<Host> {
  return request<Host>(
    apiClient.hosts[":id"].$get({ param: { id } }, requestOptions(signal)),
  );
}

export async function getEnvironment(
  id: string,
  signal?: AbortSignal,
): Promise<Environment> {
  return request<Environment>(
    apiClient.environments[":id"].$get(
      { param: { id } },
      requestOptions(signal),
    ),
  );
}

export async function updateEnvironment(
  id: string,
  req: UpdateEnvironmentRequest,
): Promise<Environment> {
  return request<Environment>(
    apiClient.environments[":id"].$patch({ param: { id }, json: req }),
  );
}

export async function getEnvironmentWorkStatus(
  environmentId: string,
  mergeBaseBranch?: string,
  signal?: AbortSignal,
): Promise<EnvironmentStatusResponse> {
  return request<EnvironmentStatusResponse>(
    apiClient.environments[":id"].status.$get(
      {
        param: { id: environmentId },
        query: mergeBaseBranch ? { mergeBaseBranch } : {},
      },
      requestOptions(signal),
    ),
  );
}

export async function getEnvironmentDiffBranches(
  id: string,
  args?: EnvironmentBranchListRequest,
): Promise<EnvironmentDiffBranchesResponse> {
  return request<EnvironmentDiffBranchesResponse>(
    apiClient.environments[":id"].diff.branches.$get({
      param: { id },
      query: buildEnvironmentDiffBranchesQuery(args),
    }),
  );
}

export async function requestEnvironmentAction(
  id: string,
  req: EnvironmentActionRequest,
): Promise<EnvironmentActionResponse> {
  return request<EnvironmentActionResponse>(
    apiClient.environments[":id"].actions.$post({ param: { id }, json: req }),
  );
}

export async function archiveEnvironmentThreads(
  id: string,
): Promise<EnvironmentArchiveThreadsResponse> {
  return request<EnvironmentArchiveThreadsResponse>(
    apiClient.environments[":id"]["archive-threads"].$post({
      param: { id },
    }),
  );
}

export async function getThreadTimeline({
  beforeCursor,
  id,
  includeNestedRows = false,
  segmentLimit,
}: GetThreadTimelineArgs): Promise<ThreadTimelineResponse> {
  return request<ThreadTimelineResponse>(
    apiClient.threads[":id"].timeline.$get({
      param: { id },
      query: {
        ...(includeNestedRows ? { includeNestedRows: "true" } : {}),
        ...(segmentLimit !== undefined
          ? { segmentLimit: String(segmentLimit) }
          : {}),
        ...(beforeCursor
          ? {
              beforeAnchorSeq: String(beforeCursor.anchorSeq),
              beforeAnchorId: beforeCursor.anchorId,
            }
          : {}),
      },
    }),
  );
}

export async function getThreadTimelineTurnSummaryDetails({
  id,
  turnId,
  sourceSeqStart,
  sourceSeqEnd,
}: GetThreadTimelineTurnSummaryDetailsArgs): Promise<TimelineTurnSummaryDetailsResponse> {
  return request<TimelineTurnSummaryDetailsResponse>(
    apiClient.threads[":id"].timeline["turn-summary-details"].$get({
      param: { id },
      query: {
        turnId,
        sourceSeqStart: String(sourceSeqStart),
        sourceSeqEnd: String(sourceSeqEnd),
      },
    }),
  );
}

export type DiffFileSide = "old" | "new";

/**
 * File-fetch target for {@link getEnvironmentDiffFile}. Differs from
 * `WorkspaceDiffTarget` for `branch_committed` / `all`: instead of the merge
 * base *branch name*, the caller must pass the resolved merge-base SHA that
 * `workspace.diff` returned (via `ThreadGitDiffResponse.mergeBaseRef`). That
 * keeps the per-file read aligned with the exact ref the diff was computed
 * against — the branch tip can drift past the merge base between the diff
 * load and the file read, breaking `@pierre/diffs`' context expansion.
 */
export type DiffFileTarget =
  | { type: "uncommitted" }
  | { type: "branch_committed"; mergeBaseRef: string }
  | { type: "all"; mergeBaseRef: string }
  | { type: "commit"; sha: string };

export async function getEnvironmentDiffFile(
  id: string,
  target: DiffFileTarget,
  path: string,
  side: DiffFileSide,
): Promise<EnvironmentDiffFileResponse> {
  const baseQuery = (() => {
    switch (target.type) {
      case "uncommitted":
        return { target: "uncommitted" as const };
      case "branch_committed":
        return {
          target: "branch_committed" as const,
          mergeBaseRef: target.mergeBaseRef,
        };
      case "all":
        return {
          target: "all" as const,
          mergeBaseRef: target.mergeBaseRef,
        };
      case "commit":
        return {
          target: "commit" as const,
          sha: target.sha,
        };
      default: {
        const _exhaustive: never = target;
        return _exhaustive;
      }
    }
  })();

  return request<EnvironmentDiffFileResponse>(
    apiClient.environments[":id"].diff.file.$get({
      param: { id },
      query: { ...baseQuery, path, side },
    }),
  );
}

export async function getEnvironmentDiff(
  id: string,
  target: WorkspaceDiffTarget,
): Promise<EnvironmentDiffResponse> {
  const query = (() => {
    switch (target.type) {
      case "uncommitted":
        return { target: "uncommitted" as const };
      case "branch_committed":
        return {
          target: "branch_committed" as const,
          mergeBaseBranch: target.mergeBaseBranch,
        };
      case "all":
        return {
          target: "all" as const,
          mergeBaseBranch: target.mergeBaseBranch,
        };
      case "commit":
        return {
          target: "commit" as const,
          sha: target.sha,
        };
      default: {
        const _exhaustive: never = target;
        return _exhaustive;
      }
    }
  })();

  return request<EnvironmentDiffResponse>(
    apiClient.environments[":id"].diff.$get({
      param: { id },
      query,
    }),
  );
}

export async function getSystemExecutionOptions(args: {
  environmentId?: string;
  providerId?: string;
}): Promise<SystemExecutionOptionsResponse> {
  return request<SystemExecutionOptionsResponse>(
    apiClient.system["execution-options"].$get({
      query: {
        ...(args.environmentId ? { environmentId: args.environmentId } : {}),
        ...(args.providerId ? { providerId: args.providerId } : {}),
      },
    }),
  );
}

export async function listSystemProviders(): Promise<SystemProviderInfo[]> {
  return request<SystemProviderInfo[]>(
    apiClient.system.providers.$get({ query: {} }),
  );
}

export async function getSystemVersion(): Promise<SystemVersionResponse> {
  return request<SystemVersionResponse>(apiClient.system.version.$get());
}

export async function getSystemConfig(): Promise<SystemConfigResponse> {
  return request<SystemConfigResponse>(apiClient.system.config.$get());
}

export async function listHosts(): Promise<Host[]> {
  return request<Host[]>(apiClient.hosts.$get());
}

/**
 * Replace the user's opt-in experiments (full object — no partial updates).
 * The server broadcasts system `config-changed`, so other windows re-read
 * `/system/config` and re-gate their surfaces.
 */
export async function updateExperiments(
  experiments: Experiments,
): Promise<Experiments> {
  return request<Experiments>(
    apiClient.settings.experiments.$put({ json: experiments }),
  );
}

interface GetWorkflowRunAgentEventsArgs {
  /** Journal-stable 1-based display index (snapshot `agent.index`). */
  agentIndex: number;
  runId: string;
}

/**
 * Workflow definitions across the registry tiers (project > user > builtin)
 * from the project's default source root. Requires the source host online —
 * 502 `host_unavailable` otherwise; 409 when the project has no default
 * source. (The route accepts an explicit `hostId` for CLI/SDK callers; the
 * SPA lists the default source only — host choice is launch-time-only.)
 */
export async function listWorkflows(
  projectId: string,
): Promise<WorkflowListResponse> {
  return request<WorkflowListResponse>(
    apiClient.workflows.$get({ query: { projectId } }),
  );
}

export async function listWorkflowRuns(
  query: WorkflowRunListQuery,
): Promise<WorkflowRunListResponse> {
  return request<WorkflowRunListResponse>(
    apiClient["workflow-runs"].$get({ query }),
  );
}

export async function createWorkflowRun(
  req: CreateWorkflowRunRequest,
): Promise<WorkflowRunResponse> {
  return request<WorkflowRunResponse>(
    apiClient["workflow-runs"].$post({ json: req }),
  );
}

export async function getWorkflowRun(id: string): Promise<WorkflowRunResponse> {
  return request<WorkflowRunResponse>(
    apiClient["workflow-runs"][":id"].$get({ param: { id } }),
  );
}

export async function getWorkflowRunEvents(
  id: string,
): Promise<WorkflowRunEventsResponse> {
  return request<WorkflowRunEventsResponse>(
    apiClient["workflow-runs"][":id"].events.$get({ param: { id } }),
  );
}

/**
 * Per-agent provider-event log, proxied from the run's host. 404 when the log
 * does not exist (agent not started or run dir pruned); 502 `host_unavailable`
 * when the daemon is offline — both surface as `HttpError`s for the drill-in
 * UI to render as distinct non-error states.
 */
export async function getWorkflowRunAgentEvents({
  agentIndex,
  runId,
}: GetWorkflowRunAgentEventsArgs): Promise<ThreadEventRow[]> {
  return request<ThreadEventRow[]>(
    apiClient["workflow-runs"][":id"].agents[":index"].events.$get({
      param: { id: runId, index: String(agentIndex) },
    }),
  );
}

export async function cancelWorkflowRun(id: string): Promise<void> {
  await requestVoid(
    apiClient["workflow-runs"][":id"].cancel.$post({ param: { id } }),
  );
}

export async function resumeWorkflowRun(id: string): Promise<void> {
  await requestVoid(
    apiClient["workflow-runs"][":id"].resume.$post({ param: { id } }),
  );
}

export async function archiveWorkflowRun(id: string): Promise<void> {
  await requestVoid(
    apiClient["workflow-runs"][":id"].archive.$post({ param: { id } }),
  );
}

export async function deleteWorkflowRun(id: string): Promise<void> {
  await requestVoid(apiClient["workflow-runs"][":id"].$delete({ param: { id } }));
}
