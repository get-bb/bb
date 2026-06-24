import { extractErrorMessage, toRecord } from "@bb/core-ui";
import type {
  AppTheme,
  AppThemeSelection,
  Environment,
  Experiments,
  Host,
  PendingInteraction,
  ProjectSource,
  ResolvedThreadExecutionOptions,
  ThreadChildOrigin,
  ThreadQueuedMessage,
  WorkspaceDiffTarget,
} from "@bb/domain";
import type {
  Automation,
  AutomationRunListResponse,
  AutomationRunResponse,
  AutomationsOverviewResponse,
  CommandListResponse,
  CreateProjectSourceRequest,
  CreateProjectRequest,
  CreateThreadFolderRequest,
  CreateQueuedMessageRequest,
  DeleteThreadFolderRequest,
  DeleteThreadRequest,
  EnvironmentArchiveThreadsResponse,
  EnvironmentActionRequest,
  EnvironmentActionResponse,
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffQuery,
  EnvironmentDiffFilesResponse,
  EnvironmentDiffPatchResponse,
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
  EnvironmentStatusResponse,
  EnvironmentPullRequestResponse,
  TerminalListResponse,
  CreateThreadRequest,
  CreateTerminalRequest,
  ProjectBranchesResponse,
  ProjectResponse,
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
  ThreadFolderMutationResponse,
  ThreadFolderResponse,
  ThreadPendingInteractionsResponse,
  ThreadQueuedMessageListResponse,
  ThreadListResponse,
  ThreadSearchResponse,
  ThreadResponse,
  ThreadWithIncludesResponse,
  PathListIncludeQueryValue,
  BranchListQuery,
  EnvironmentDiffBranchesQuery,
  ProjectBranchesQuery,
  ThreadStorageFilesQuery,
  ThreadStoragePathsQuery,
  TerminalListQuery,
  TerminalSession,
  ThreadTimelineResponse,
  TimelineTurnSummaryDetailsRequest,
  TimelineTurnSummaryDetailsResponse,
  CloseTerminalRequest,
  ResolvePendingInteractionRequest,
  UpdateEnvironmentRequest,
  UpdateThreadFolderRequest,
  UpdateTerminalRequest,
  UpdateProjectRequest,
  UpdateThreadRequest,
  UpdateProjectSourceRequest,
  UploadedPromptAttachment,
  ThreadStorageFileListResponse,
  ThreadStoragePathListResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import { apiClient, toRelativeUrl } from "./api-server";
import {
  buildFilePreview,
  normalizeFilePreviewMimeType,
  type EnvironmentFilePreviewSource,
  type FilePreview,
  type FilePreviewTarget,
} from "./file-preview";
import {
  buildProjectFileContentUrl,
  buildThreadHostFileContentUrl,
  buildThreadStorageContentUrl,
} from "./file-content-urls";
import type { ThreadStorageFileListOptions } from "./thread-storage-files";
import type { PathListOptions } from "./path-list-options";
export type { FilePreview } from "./file-preview";

interface GetThreadTimelineArgs {
  afterSequence?: number;
  beforeCursor?: TimelinePaginationCursor;
  id: string;
  includeNestedRows?: boolean;
  segmentLimit?: number;
  signal?: AbortSignal;
}

interface GetThreadTimelineTurnSummaryDetailsArgs extends TimelineTurnSummaryDetailsRequest {
  id: string;
  signal?: AbortSignal;
}

interface GetEnvironmentFilePreviewArgs {
  id: string;
  path: string;
  source: EnvironmentFilePreviewSource;
  signal?: AbortSignal;
}

interface GetProjectFilePreviewArgs {
  projectId: string;
  path: string;
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

// Built by the client and sent to POST /threads, which parses with
// createThreadRequestSchema. `startedOnBehalfOf`, `originKind`, and
// `childOrigin` are
// `.nullable().default(null)` in the schema, so callers (only the fork /
// side-chat paths) may omit them; the explicit `null` is supplied once in
// `createThread` because the wire body type is the schema's *output* shape,
// where those defaulted fields are required.
export type AppCreateThreadRequest = Omit<
  CreateThreadRequest,
  "origin" | "startedOnBehalfOf" | "originKind" | "childOrigin"
> &
  Partial<
    Pick<
      CreateThreadRequest,
      "startedOnBehalfOf" | "originKind" | "childOrigin"
    >
  >;

const HTML_DOCUMENT_PATTERN = /<!doctype html|<html[\s>]/i;
const ERROR_EXTRACT_OPTS = {
  legacyKeys: ["detail"] as const,
};

function normalizeErrorText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function requestOptions(signal?: AbortSignal) {
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

export async function request<T>(
  responsePromise: Promise<Response>,
): Promise<T> {
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

export async function getProjectFilePreview({
  projectId,
  path,
  signal,
}: GetProjectFilePreviewArgs): Promise<FilePreview> {
  return loadFilePreview(
    {
      name: path.split("/").at(-1),
      path,
      url: buildProjectFileContentUrl(projectId, path),
    },
    signal,
  );
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

export async function createProject(
  req: CreateProjectRequest,
): Promise<ProjectResponse> {
  return request<ProjectResponse>(apiClient.projects.$post({ json: req }));
}

export async function createThreadFolder(
  req: CreateThreadFolderRequest,
): Promise<ThreadFolderResponse> {
  return request<ThreadFolderResponse>(
    apiClient["thread-folders"].$post({ json: req }),
  );
}

export async function updateThreadFolder(
  req: UpdateThreadFolderRequest,
): Promise<ThreadFolderMutationResponse> {
  return request<ThreadFolderMutationResponse>(
    apiClient["thread-folders"].$patch({ json: req }),
  );
}

export async function deleteThreadFolder(
  req: DeleteThreadFolderRequest,
): Promise<ThreadFolderMutationResponse> {
  return request<ThreadFolderMutationResponse>(
    apiClient["thread-folders"].$delete({ json: req }),
  );
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

export async function deleteProject(id: string): Promise<void> {
  await requestVoid(apiClient.projects[":id"].$delete({ param: { id } }));
}

export async function listAutomations(
  signal?: AbortSignal,
): Promise<AutomationsOverviewResponse> {
  return request<AutomationsOverviewResponse>(
    apiClient.automations.$get(undefined, requestOptions(signal)),
  );
}

interface AutomationRef {
  projectId: string;
  automationId: string;
}

interface GetAutomationArgs extends AutomationRef {
  signal?: AbortSignal;
}

interface ListAutomationRunsArgs extends AutomationRef {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export async function getAutomation({
  projectId,
  automationId,
  signal,
}: GetAutomationArgs): Promise<Automation> {
  return request<Automation>(
    apiClient.projects[":id"].automations[":automationId"].$get(
      { param: { id: projectId, automationId } },
      requestOptions(signal),
    ),
  );
}

export async function listAutomationRuns({
  projectId,
  automationId,
  limit,
  cursor,
  signal,
}: ListAutomationRunsArgs): Promise<AutomationRunListResponse> {
  return request<AutomationRunListResponse>(
    apiClient.projects[":id"].automations[":automationId"].runs.$get(
      {
        param: { id: projectId, automationId },
        query: {
          ...(limit !== undefined ? { limit: String(limit) } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
      requestOptions(signal),
    ),
  );
}

export async function pauseAutomation({
  projectId,
  automationId,
}: AutomationRef): Promise<Automation> {
  return request<Automation>(
    apiClient.projects[":id"].automations[":automationId"].pause.$post({
      param: { id: projectId, automationId },
    }),
  );
}

export async function resumeAutomation({
  projectId,
  automationId,
}: AutomationRef): Promise<Automation> {
  return request<Automation>(
    apiClient.projects[":id"].automations[":automationId"].resume.$post({
      param: { id: projectId, automationId },
    }),
  );
}

export async function runAutomation({
  projectId,
  automationId,
}: AutomationRef): Promise<AutomationRunResponse> {
  return request<AutomationRunResponse>(
    apiClient.projects[":id"].automations[":automationId"].run.$post({
      param: { id: projectId, automationId },
      json: {},
    }),
  );
}

export async function deleteAutomation({
  projectId,
  automationId,
}: AutomationRef): Promise<void> {
  await requestVoid(
    apiClient.projects[":id"].automations[":automationId"].$delete({
      param: { id: projectId, automationId },
    }),
  );
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
  includeFiles: boolean;
  includeDirectories: boolean;
  signal?: AbortSignal;
}

interface SearchEnvironmentPathsArgs {
  environmentId: string;
  query: string;
  limit: number;
  includeFiles: boolean;
  includeDirectories: boolean;
  signal?: AbortSignal;
}

function toPathListIncludeQueryValue(
  value: boolean,
): PathListIncludeQueryValue {
  return value ? "true" : "false";
}

/**
 * Search the project's default source path. Used by the new-thread compose box
 * before any environment exists; once a thread has an environment, workspace
 * path search goes through {@link searchEnvironmentPaths}.
 */
export async function searchProjectPaths(
  args: SearchProjectPathsArgs,
): Promise<WorkspacePathListResponse> {
  return request<WorkspacePathListResponse>(
    apiClient.projects[":id"].paths.$get(
      {
        param: { id: args.projectId },
        query: {
          query: args.query,
          limit: String(args.limit),
          // The project-source listing has no environment to scope to; the shared
          // query schema still carries the field, so send the empty string (=
          // null) to select the default source.
          environmentId: "",
          includeFiles: toPathListIncludeQueryValue(args.includeFiles),
          includeDirectories: toPathListIncludeQueryValue(
            args.includeDirectories,
          ),
        },
      },
      requestOptions(args.signal),
    ),
  );
}

/** Search the workspace of an existing thread's environment (project-agnostic). */
export async function searchEnvironmentPaths(
  args: SearchEnvironmentPathsArgs,
): Promise<WorkspacePathListResponse> {
  return request<WorkspacePathListResponse>(
    apiClient.environments[":id"].paths.$get(
      {
        param: { id: args.environmentId },
        query: {
          query: args.query,
          limit: String(args.limit),
          includeFiles: toPathListIncludeQueryValue(args.includeFiles),
          includeDirectories: toPathListIncludeQueryValue(
            args.includeDirectories,
          ),
        },
      },
      requestOptions(args.signal),
    ),
  );
}

interface ListProjectCommandsArgs {
  projectId: string;
  providerId: string;
  environmentId: string | null;
  query: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}

/**
 * List the provider skills/slash-commands discoverable for a project, scoped by
 * provider + environment, for the in-composer command typeahead (`/`). Serves
 * both the existing-thread follow-up composer and the new-thread composer.
 * Mirrors {@link searchProjectPaths}: the typed Hono
 * client resolves the route from `@bb/server-contract`'s public-api schema, so
 * this types against the committed `CommandListResponse` contract with no cast,
 * and encodes a null `environmentId` as the empty string on the wire.
 */
export async function listProjectCommands(
  args: ListProjectCommandsArgs,
): Promise<CommandListResponse> {
  return request<CommandListResponse>(
    apiClient.projects[":id"].commands.$get(
      {
        param: { id: args.projectId },
        query: {
          provider: args.providerId,
          environmentId: args.environmentId ?? "",
          ...(args.query.length > 0 ? { query: args.query } : {}),
          limit: String(args.limit),
          ...(args.offset > 0 ? { offset: String(args.offset) } : {}),
        },
      },
      requestOptions(args.signal),
    ),
  );
}

export async function getProjectSourceBranches(
  projectId: string,
  hostId: string,
  args?: ProjectBranchListRequest,
  signal?: AbortSignal,
): Promise<ProjectBranchesResponse> {
  return request<ProjectBranchesResponse>(
    apiClient.projects[":id"].branches.$get(
      {
        param: { id: projectId },
        query: buildProjectBranchesQuery(hostId, args),
      },
      requestOptions(signal),
    ),
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
        startedOnBehalfOf: req.startedOnBehalfOf ?? null,
        originKind: req.originKind ?? req.childOrigin ?? null,
        childOrigin: req.childOrigin ?? null,
      },
    }),
  );
}

export interface ThreadListFilters {
  projectId?: string;
  parentThreadId?: string;
  sourceThreadId?: string;
  /** Restrict to threads filed directly under this folder. */
  folderId?: string;
  /** Restrict to loose threads — those not filed under any folder. */
  unfiled?: boolean;
  hasParent?: boolean;
  /** Restrict to threads spawned with this origin (fork or side-chat). */
  originKind?: ThreadChildOrigin;
  /** Exclude source-derived side-chat threads. */
  excludeSideChats?: boolean;
  /** @deprecated Use originKind. */
  childOrigin?: ThreadChildOrigin;
  /** App callers must choose active or archived; server omission intentionally means both. */
  archived: boolean;
  limit?: number;
  offset?: number;
}

export interface ThreadSearchFilters {
  query: string;
  limitPerGroup?: number;
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
          ...(filters.sourceThreadId
            ? { sourceThreadId: filters.sourceThreadId }
            : {}),
          ...(filters.folderId ? { folderId: filters.folderId } : {}),
          ...(filters.unfiled ? { unfiled: toBooleanQueryValue(true) } : {}),
          ...(filters.hasParent !== undefined
            ? { hasParent: toBooleanQueryValue(filters.hasParent) }
            : {}),
          ...(filters.originKind ? { originKind: filters.originKind } : {}),
          ...(filters.excludeSideChats !== undefined
            ? {
                excludeSideChats: toBooleanQueryValue(
                  filters.excludeSideChats,
                ),
              }
            : {}),
          ...(filters.childOrigin ? { childOrigin: filters.childOrigin } : {}),
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

export async function searchThreads(
  filters: ThreadSearchFilters,
  signal?: AbortSignal,
): Promise<ThreadSearchResponse> {
  return request<ThreadSearchResponse>(
    apiClient.threads.search.$get(
      {
        query: {
          query: filters.query,
          ...(filters.limitPerGroup !== undefined
            ? { limitPerGroup: String(filters.limitPerGroup) }
            : {}),
        },
      },
      requestOptions(signal),
    ),
  );
}

export async function getThread(
  id: string,
  signal?: AbortSignal,
): Promise<ThreadResponse> {
  return request<ThreadResponse>(
    apiClient.threads[":id"].$get({ param: { id } }, requestOptions(signal)),
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

export async function listTerminals(
  query: TerminalListQuery,
  signal?: AbortSignal,
): Promise<TerminalListResponse> {
  return request<TerminalListResponse>(
    apiClient.terminals.$get({ query }, requestOptions(signal)),
  );
}

export async function createTerminal(
  req: CreateTerminalRequest,
): Promise<TerminalSession> {
  return request<TerminalSession>(
    apiClient.terminals.$post({
      json: req,
    }),
  );
}

export async function renameTerminal(
  terminalId: string,
  req: UpdateTerminalRequest,
): Promise<TerminalSession> {
  return request<TerminalSession>(
    apiClient.terminals[":terminalId"].$patch({
      param: { terminalId },
      json: req,
    }),
  );
}

export async function closeTerminal(
  terminalId: string,
  req: CloseTerminalRequest,
): Promise<TerminalSession> {
  return request<TerminalSession>(
    apiClient.terminals[":terminalId"].close.$post({
      param: { terminalId },
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

export async function listThreadQueuedMessages(
  id: string,
  signal?: AbortSignal,
): Promise<ThreadQueuedMessageListResponse> {
  return request<ThreadQueuedMessageListResponse>(
    apiClient.threads[":id"]["queued-messages"].$get(
      { param: { id } },
      requestOptions(signal),
    ),
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

export async function getThreadDefaultExecutionOptions(
  id: string,
  signal?: AbortSignal,
): Promise<ResolvedThreadExecutionOptions | null> {
  return request<ResolvedThreadExecutionOptions | null>(
    apiClient.threads[":id"]["default-execution-options"].$get(
      {
        param: { id },
      },
      requestOptions(signal),
    ),
  );
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

export async function getHost(id: string, signal?: AbortSignal): Promise<Host> {
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

export async function getEnvironmentPullRequest(
  environmentId: string,
  signal?: AbortSignal,
): Promise<EnvironmentPullRequestResponse> {
  return request<EnvironmentPullRequestResponse>(
    apiClient.environments[":id"]["pull-request"].$get(
      { param: { id: environmentId } },
      requestOptions(signal),
    ),
  );
}

export async function getEnvironmentDiffBranches(
  id: string,
  args?: EnvironmentBranchListRequest,
  signal?: AbortSignal,
): Promise<EnvironmentDiffBranchesResponse> {
  return request<EnvironmentDiffBranchesResponse>(
    apiClient.environments[":id"].diff.branches.$get(
      {
        param: { id },
        query: buildEnvironmentDiffBranchesQuery(args),
      },
      requestOptions(signal),
    ),
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
  afterSequence,
  beforeCursor,
  id,
  includeNestedRows = false,
  segmentLimit,
  signal,
}: GetThreadTimelineArgs): Promise<ThreadTimelineResponse> {
  return request<ThreadTimelineResponse>(
    apiClient.threads[":id"].timeline.$get(
      {
        param: { id },
        query: {
          ...(includeNestedRows ? { includeNestedRows: "true" } : {}),
          ...(segmentLimit !== undefined
            ? { segmentLimit: String(segmentLimit) }
            : {}),
          ...(afterSequence !== undefined
            ? { afterSequence: String(afterSequence) }
            : {}),
          ...(beforeCursor
            ? {
                beforeAnchorSeq: String(beforeCursor.anchorSeq),
                beforeAnchorId: beforeCursor.anchorId,
              }
            : {}),
        },
      },
      requestOptions(signal),
    ),
  );
}

export async function getThreadTimelineTurnSummaryDetails({
  id,
  signal,
  turnId,
  sourceSeqStart,
  sourceSeqEnd,
}: GetThreadTimelineTurnSummaryDetailsArgs): Promise<TimelineTurnSummaryDetailsResponse> {
  return request<TimelineTurnSummaryDetailsResponse>(
    apiClient.threads[":id"].timeline["turn-summary-details"].$get(
      {
        param: { id },
        query: {
          turnId,
          sourceSeqStart: String(sourceSeqStart),
          sourceSeqEnd: String(sourceSeqEnd),
        },
      },
      requestOptions(signal),
    ),
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
  signal?: AbortSignal,
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
    apiClient.environments[":id"].diff.file.$get(
      {
        param: { id },
        query: { ...baseQuery, path, side },
      },
      requestOptions(signal),
    ),
  );
}

/**
 * Encode a {@link WorkspaceDiffTarget} into the flat query shape shared by the
 * `/diff`, `/diff/files`, and (inside its JSON body) `/diff/patch` routes.
 */
function buildEnvironmentDiffTargetQuery(
  target: WorkspaceDiffTarget,
): EnvironmentDiffQuery {
  switch (target.type) {
    case "uncommitted":
      return { target: "uncommitted" };
    case "branch_committed":
      return {
        target: "branch_committed",
        mergeBaseBranch: target.mergeBaseBranch,
      };
    case "all":
      return {
        target: "all",
        mergeBaseBranch: target.mergeBaseBranch,
      };
    case "commit":
      return {
        target: "commit",
        sha: target.sha,
      };
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/**
 * Fetch the diff tab's table of contents (one {@link DiffFileEntry} per changed
 * file, no patch text).
 */
export async function getEnvironmentDiffFiles(
  id: string,
  target: WorkspaceDiffTarget,
  signal?: AbortSignal,
): Promise<EnvironmentDiffFilesResponse> {
  return request<EnvironmentDiffFilesResponse>(
    apiClient.environments[":id"].diff.files.$get(
      {
        param: { id },
        query: buildEnvironmentDiffTargetQuery(target),
      },
      requestOptions(signal),
    ),
  );
}

interface GetEnvironmentDiffPatchesArgs {
  target: WorkspaceDiffTarget;
  paths: string[];
  signal?: AbortSignal;
}

/**
 * Fetch unified patch text for a subset of changed files. POST (not GET)
 * because the repeated `paths` array cannot survive flat query parsing; the
 * server re-derives each file's rename/copy pairing from its own TOC.
 */
export async function getEnvironmentDiffPatches(
  id: string,
  { target, paths, signal }: GetEnvironmentDiffPatchesArgs,
): Promise<EnvironmentDiffPatchResponse> {
  return request<EnvironmentDiffPatchResponse>(
    apiClient.environments[":id"].diff.patch.$post(
      {
        param: { id },
        json: { target, paths },
      },
      requestOptions(signal),
    ),
  );
}

export async function getSystemExecutionOptions(args: {
  environmentId?: string;
  providerId?: string;
  signal?: AbortSignal;
}): Promise<SystemExecutionOptionsResponse> {
  return request<SystemExecutionOptionsResponse>(
    apiClient.system["execution-options"].$get(
      {
        query: {
          ...(args.environmentId ? { environmentId: args.environmentId } : {}),
          ...(args.providerId ? { providerId: args.providerId } : {}),
        },
      },
      requestOptions(args.signal),
    ),
  );
}

export async function listSystemProviders(): Promise<SystemProviderInfo[]> {
  return request<SystemProviderInfo[]>(
    apiClient.system.providers.$get({ query: {} }),
  );
}

export async function getSystemVersion(
  signal?: AbortSignal,
): Promise<SystemVersionResponse> {
  return request<SystemVersionResponse>(
    apiClient.system.version.$get({}, requestOptions(signal)),
  );
}

export async function getSystemConfig(
  signal?: AbortSignal,
): Promise<SystemConfigResponse> {
  return request<SystemConfigResponse>(
    apiClient.system.config.$get({}, requestOptions(signal)),
  );
}

export async function getSystemUsageLimits(
  signal?: AbortSignal,
): Promise<ProviderUsageResponse> {
  return request<ProviderUsageResponse>(
    apiClient.system["usage-limits"].$get({}, requestOptions(signal)),
  );
}

export async function updateExperiments(
  experiments: Experiments,
): Promise<Experiments> {
  return request<Experiments>(
    apiClient.settings.experiments.$put({ json: experiments }),
  );
}

export async function updateAppearance(
  selection: AppThemeSelection,
): Promise<AppTheme> {
  return request<AppTheme>(
    apiClient.settings.appearance.$put({ json: selection }),
  );
}

export async function listHosts(signal?: AbortSignal): Promise<Host[]> {
  return request<Host[]>(apiClient.hosts.$get({}, requestOptions(signal)));
}
