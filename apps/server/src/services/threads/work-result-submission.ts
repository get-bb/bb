import type { JsonObject } from "@bb/domain";

const WORK_KINDS = [
  "conversation",
  "research",
  "plan",
  "writing",
  "code",
  "other",
] as const;
const ARTIFACT_KINDS = [
  "document",
  "dataset",
  "image",
  "archive",
  "other",
] as const;
const MEDIA_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/zip",
  "application/octet-stream",
  "image/png",
  "image/jpeg",
] as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PRIVATE_RESULT_KEYS = new Set([
  "actor",
  "actorid",
  "actorlabel",
  "agent",
  "agentid",
  "agentlabel",
  "author",
  "authorid",
  "principal",
  "principalid",
  "providerthreadid",
  "subagent",
  "subagents",
  "subagentstatuses",
  "threadid",
  "transcript",
  "transcriptcopy",
  "userid",
]);

export type WorkResultValidationProfile = Readonly<{
  workKind: (typeof WORK_KINDS)[number];
  environmentTemplate:
    | "isolated-scratch"
    | "detached-read-only"
    | "managed-worktree";
  repositorySnapshotId: string | null;
  objectFormat: "sha1" | "sha256" | null;
  baseRevision: string | null;
  generatedBranch: string | null;
}>;

type RecordValue = Record<string, unknown>;

function invalid(): never {
  throw new TypeError("Invalid Work Together result submission");
}

function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid();
  }
  const candidate = value as RecordValue;
  const allowed = new Set([...required, ...optional]);
  if (
    Object.keys(candidate).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(candidate, key))
  ) {
    invalid();
  }
  return candidate;
}

function rejectPrivateKeys(value: unknown, depth = 0): void {
  if (depth > 32) invalid();
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) rejectPrivateKeys(item, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const token = key.toLowerCase().replaceAll(/[-_]/gu, "");
    if (PRIVATE_RESULT_KEYS.has(token)) invalid();
    rejectPrivateKeys(item, depth + 1);
  }
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid();
  return value as T[number];
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid();
  }
  return value;
}

function text(
  value: unknown,
  maximumScalars: number,
  options: { allowEmpty?: boolean; multiline?: boolean } = {},
): string {
  if (typeof value !== "string") invalid();
  const normalized = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC");
  const controls = options.multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u
    : /[\u0000-\u001f\u007f-\u009f]/u;
  const count = [...normalized].length;
  if (
    controls.test(normalized) ||
    /<\s*\/?\s*[a-z][^>]*>/iu.test(normalized) ||
    (!options.allowEmpty && count === 0) ||
    count > maximumScalars
  ) {
    invalid();
  }
  return normalized;
}

function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value.toLowerCase();
}

function objectFormat(value: unknown): "sha1" | "sha256" {
  return enumValue(value, ["sha1", "sha256"] as const);
}

function revision(value: unknown, format: "sha1" | "sha256"): string {
  const length = format === "sha1" ? 40 : 64;
  if (
    typeof value !== "string" ||
    value.length !== length ||
    !/^[0-9a-f]+$/u.test(value)
  ) {
    invalid();
  }
  return value;
}

function repositoryPath(value: unknown): string {
  if (typeof value !== "string") invalid();
  const components = value.split("/");
  if (
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > 1_024 ||
    components.length > 64 ||
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value) ||
    components.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.toLowerCase() === ".git" ||
        Buffer.byteLength(part, "utf8") > 255,
    )
  ) {
    invalid();
  }
  return value;
}

function branchName(value: unknown): string {
  if (typeof value !== "string") invalid();
  if (
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > 255 ||
    value.startsWith("-") ||
    value.startsWith(".") ||
    value.endsWith(".") ||
    value.endsWith("/") ||
    value.endsWith(".lock") ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("//") ||
    value.includes("\\") ||
    value.includes(" ") ||
    value.includes("~") ||
    value.includes("^") ||
    value.includes(":") ||
    value.includes("?") ||
    value.includes("*") ||
    value.includes("[") ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value === "@" ||
    value.startsWith("refs/") ||
    value
      .split("/")
      .some((part) => !part || part.startsWith(".") || part.endsWith("."))
  ) {
    invalid();
  }
  return value;
}

function sourceRef(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid();
  const kindValue = (value as RecordValue).kind;
  if (kindValue === "external_url") {
    const source = record(value, ["kind", "url"], ["title"]);
    if (
      typeof source.url !== "string" ||
      Buffer.byteLength(source.url, "utf8") > 2_048
    ) {
      invalid();
    }
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      invalid();
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash
    ) {
      invalid();
    }
    if (url.port === "443") url.port = "";
    return {
      kind: "external_url",
      url: url.toString(),
      ...(source.title === undefined
        ? {}
        : { title: text(source.title, 240, { allowEmpty: true }) }),
    };
  }
  if (kindValue === "repository_object") {
    const source = record(
      value,
      ["kind", "repositorySnapshotId", "objectFormat", "revision"],
      ["path"],
    );
    const format = objectFormat(source.objectFormat);
    return {
      kind: "repository_object",
      repositorySnapshotId: uuid(source.repositorySnapshotId),
      objectFormat: format,
      revision: revision(source.revision, format),
      ...(source.path === undefined
        ? {}
        : { path: repositoryPath(source.path) }),
    };
  }
  const ids = {
    task: "taskId",
    room: "roomId",
    result: "resultId",
    memory_item: "memoryItemId",
  } as const;
  if (typeof kindValue !== "string" || !(kindValue in ids)) invalid();
  const kind = kindValue as keyof typeof ids;
  const idKey = ids[kind];
  const source = record(value, ["kind", idKey], ["version"]);
  return {
    kind,
    [idKey]: uuid(source[idKey]),
    ...(source.version === undefined
      ? {}
      : { version: integer(source.version, 1) }),
  };
}

function artifactRef(value: unknown): JsonObject {
  const artifact = record(value, [
    "refKind",
    "artifactId",
    "artifactKind",
    "name",
    "mediaType",
    "sizeBytes",
    "sha256",
  ]);
  if (artifact.refKind !== "artifact") invalid();
  if (
    typeof artifact.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(artifact.sha256)
  ) {
    invalid();
  }
  return {
    refKind: "artifact",
    artifactId: uuid(artifact.artifactId),
    artifactKind: enumValue(artifact.artifactKind, ARTIFACT_KINDS),
    name: text(artifact.name, 240),
    mediaType: enumValue(artifact.mediaType, MEDIA_TYPES),
    sizeBytes: integer(artifact.sizeBytes, 0, 10_737_418_240),
    sha256: artifact.sha256,
  };
}

function decisions(value: unknown): JsonObject[] {
  if (!Array.isArray(value) || value.length > 50) invalid();
  const ids = new Set<string>();
  return value.map((entry) => {
    const item = record(entry, ["id", "text"]);
    if (
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(item.id)
    ) {
      invalid();
    }
    if (ids.has(item.id)) invalid();
    ids.add(item.id);
    return { id: item.id, text: text(item.text, 2_000, { multiline: true }) };
  });
}

function gitEvidence(value: unknown): JsonObject {
  const evidence = record(
    value,
    [
      "schemaVersion",
      "repositorySnapshotId",
      "objectFormat",
      "branch",
      "commits",
      "changedFiles",
    ],
    ["pullRequest", "mergeRevision"],
  );
  if (evidence.schemaVersion !== 1) invalid();
  const format = objectFormat(evidence.objectFormat);
  const branch = record(evidence.branch, ["name", "headRevision"]);
  if (!Array.isArray(evidence.commits) || evidence.commits.length > 100)
    invalid();
  const commitIds = new Set<string>();
  const commits = evidence.commits.map((entry) => {
    const commit = record(entry, ["revision"], ["title"]);
    const id = revision(commit.revision, format);
    if (commitIds.has(id)) invalid();
    commitIds.add(id);
    return {
      revision: id,
      ...(commit.title === undefined
        ? {}
        : { title: text(commit.title, 240, { allowEmpty: true }) }),
    };
  });
  if (
    !Array.isArray(evidence.changedFiles) ||
    evidence.changedFiles.length > 500
  )
    invalid();
  const changedFiles: JsonObject[] = evidence.changedFiles.map(
    (entry): JsonObject => {
      const changed = record(entry, ["path", "change"], ["previousPath"]);
      const path = repositoryPath(changed.path);
      const change = enumValue(changed.change, [
        "added",
        "modified",
        "deleted",
        "renamed",
      ] as const);
      if (change === "renamed") {
        const previousPath = repositoryPath(changed.previousPath);
        if (previousPath === path) invalid();
        return { path, change, previousPath };
      }
      if (changed.previousPath !== undefined) invalid();
      return { path, change };
    },
  );
  let pullRequest: JsonObject | undefined;
  if (evidence.pullRequest !== undefined) {
    const pull = record(evidence.pullRequest, ["provider", "number"]);
    if (pull.provider !== "github") invalid();
    pullRequest = {
      provider: "github",
      number: integer(pull.number, 1, 2_147_483_647),
    };
  }
  return {
    schemaVersion: 1,
    repositorySnapshotId: uuid(evidence.repositorySnapshotId),
    objectFormat: format,
    branch: {
      name: branchName(branch.name),
      headRevision: revision(branch.headRevision, format),
    },
    commits,
    changedFiles,
    ...(pullRequest === undefined ? {} : { pullRequest }),
    ...(evidence.mergeRevision === undefined
      ? {}
      : { mergeRevision: revision(evidence.mergeRevision, format) }),
  };
}

function canonicalWorkResultJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) invalid();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalWorkResultJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => {
        if (child === undefined) invalid();
        return `${JSON.stringify(key)}:${canonicalWorkResultJson(child)}`;
      })
      .join(",")}}`;
  }
  return invalid();
}

export function parseWorkResultSubmission(
  value: unknown,
  profile: WorkResultValidationProfile,
): JsonObject {
  rejectPrivateKeys(value);
  const submission = record(
    value,
    [
      "schemaVersion",
      "kind",
      "summary",
      "decisions",
      "nextActions",
      "sourceRefs",
      "artifactRefs",
    ],
    ["gitEvidence"],
  );
  if (submission.schemaVersion !== 1) invalid();
  const kind = enumValue(submission.kind, WORK_KINDS);
  if (kind !== profile.workKind) invalid();
  if (
    !Array.isArray(submission.sourceRefs) ||
    submission.sourceRefs.length > 100 ||
    !Array.isArray(submission.artifactRefs) ||
    submission.artifactRefs.length > 100
  ) {
    invalid();
  }
  const sourceRefs = submission.sourceRefs.map(sourceRef);
  const artifactRefs = submission.artifactRefs.map(artifactRef);
  if (
    new Set(sourceRefs.map(canonicalWorkResultJson)).size !==
      sourceRefs.length ||
    new Set(artifactRefs.map((item) => item.artifactId)).size !==
      artifactRefs.length
  ) {
    invalid();
  }
  for (const source of sourceRefs) {
    if (source.kind !== "repository_object") continue;
    if (
      profile.environmentTemplate === "isolated-scratch" ||
      source.repositorySnapshotId !== profile.repositorySnapshotId ||
      source.objectFormat !== profile.objectFormat ||
      (profile.environmentTemplate === "detached-read-only" &&
        source.revision !== profile.baseRevision)
    ) {
      invalid();
    }
  }
  let evidence: JsonObject | undefined;
  if (submission.gitEvidence !== undefined) {
    if (profile.environmentTemplate !== "managed-worktree") invalid();
    evidence = gitEvidence(submission.gitEvidence);
    const evidenceBranch = evidence.branch;
    if (
      evidence.repositorySnapshotId !== profile.repositorySnapshotId ||
      evidence.objectFormat !== profile.objectFormat ||
      evidenceBranch === null ||
      typeof evidenceBranch !== "object" ||
      Array.isArray(evidenceBranch) ||
      evidenceBranch.name !== profile.generatedBranch
    ) {
      invalid();
    }
  }
  const parsed: JsonObject = {
    schemaVersion: 1,
    kind,
    summary: text(submission.summary, 20_000, {
      allowEmpty: true,
      multiline: true,
    }),
    decisions: decisions(submission.decisions),
    nextActions: decisions(submission.nextActions),
    sourceRefs,
    artifactRefs,
    ...(evidence === undefined ? {} : { gitEvidence: evidence }),
  };
  if (Buffer.byteLength(canonicalWorkResultJson(parsed), "utf8") > 131_072)
    invalid();
  return parsed;
}
