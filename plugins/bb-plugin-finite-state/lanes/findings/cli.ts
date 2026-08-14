import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@bb/plugin-sdk";
import { isAbsolute, relative, resolve } from "node:path";

import type { NamespacedCliRunner } from "../sync/cli.js";
import type { FindingsDriftService } from "./drift/index.js";
import { MAX_VENDOR_VEX_BYTES } from "./drift/vendor/parse.js";

const TRIAGE_USAGE = `usage:
  bb finite-state triage --help
  bb finite-state triage drift report --project ID --version ID [--cursor CURSOR] [--limit N] [--json]
  bb finite-state triage drift refresh --project ID --version ID [--limit N] [--json]
  bb finite-state triage import-vex preview <file> --vendor NAME --project ID --version ID [--json]
  bb finite-state triage import-vex apply --import-id ID --expected-document-sha256 SHA256 --project ID --version ID [--json]
  bb finite-state triage orphans list --project ID --version ID [--json]
  bb finite-state triage orphans prune --stable-key KEY [--stable-key KEY ... (max 500 per invocation)] --expected-base SHA256 --project ID --version ID [--json]`;

type DriftCliVerb = "drift" | "import-vex" | "orphans";

interface ParsedArgs {
  verb: DriftCliVerb;
  action: "report" | "refresh" | "preview" | "apply" | "list" | "prune";
  projectId: string;
  projectVersionId: string;
  cursor: string | null;
  limit: number;
  json: boolean;
  file: string | null;
  vendor: string | null;
  importId: string | null;
  expectedDocumentSha256: string | null;
  expectedBaseStateSha256: string | null;
  stableKeys: string[];
}

type ParseResult = { help: true } | { help: false; input: ParsedArgs };

interface WorkspaceExecution {
  hostId: string;
  root: string;
  workspaceProjectId: string;
}

type ScopeAssertion = (input: {
  workspaceProjectId: string;
  platformProjectId: string;
  projectVersionId: string;
}) => void;

function optionValue(
  args: readonly string[],
  index: number,
  option: string,
): { value: string; consumed: number } {
  const current = args[index] ?? "";
  const equals = current.indexOf("=");
  if (equals >= 0) {
    const value = current.slice(equals + 1);
    if (!value) throw new Error(`${option} requires a value`);
    return { value, consumed: 1 };
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return { value, consumed: 2 };
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return parsed;
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const args = [...argv];
  if (args.includes("--help")) return { help: true };
  const rawVerb = args.shift();
  if (
    rawVerb !== "drift" &&
    rawVerb !== "import-vex" &&
    rawVerb !== "orphans"
  ) {
    throw new Error(TRIAGE_USAGE);
  }
  let action: ParsedArgs["action"];
  let file: string | null = null;
  if (rawVerb === "drift") {
    const candidate = args.shift();
    if (candidate !== "report" && candidate !== "refresh") {
      throw new Error("drift requires report or refresh\n" + TRIAGE_USAGE);
    }
    action = candidate;
  } else if (rawVerb === "import-vex") {
    const candidate = args.shift();
    if (candidate !== "preview" && candidate !== "apply") {
      throw new Error("import-vex requires preview or apply\n" + TRIAGE_USAGE);
    }
    action = candidate;
    if (action === "preview") {
      const candidateFile = args.shift();
      if (!candidateFile || candidateFile.startsWith("--")) {
        throw new Error("import-vex preview requires <file>");
      }
      file = candidateFile;
    }
  } else {
    const candidate = args.shift();
    if (candidate !== "list" && candidate !== "prune") {
      throw new Error("orphans requires list or prune\n" + TRIAGE_USAGE);
    }
    action = candidate;
  }

  let projectId: string | null = null;
  let projectVersionId: string | null = null;
  let cursor: string | null = null;
  let limit = 100;
  let limitSpecified = false;
  let json = false;
  let vendor: string | null = null;
  let importId: string | null = null;
  let expectedDocumentSha256: string | null = null;
  let expectedBaseStateSha256: string | null = null;
  const stableKeys: string[] = [];
  for (let index = 0; index < args.length; ) {
    const arg = args[index] ?? "";
    if (arg === "--json") {
      json = true;
      index += 1;
    } else if (arg === "--project" || arg.startsWith("--project=")) {
      const option = optionValue(args, index, "--project");
      projectId = option.value;
      index += option.consumed;
    } else if (arg === "--version" || arg.startsWith("--version=")) {
      const option = optionValue(args, index, "--version");
      projectVersionId = option.value;
      index += option.consumed;
    } else if (arg === "--cursor" || arg.startsWith("--cursor=")) {
      const option = optionValue(args, index, "--cursor");
      cursor = option.value;
      index += option.consumed;
    } else if (arg === "--limit" || arg.startsWith("--limit=")) {
      const option = optionValue(args, index, "--limit");
      limit = positiveInteger(option.value, "--limit");
      limitSpecified = true;
      index += option.consumed;
    } else if (arg === "--vendor" || arg.startsWith("--vendor=")) {
      const option = optionValue(args, index, "--vendor");
      vendor = option.value;
      index += option.consumed;
    } else if (arg === "--import-id" || arg.startsWith("--import-id=")) {
      const option = optionValue(args, index, "--import-id");
      importId = option.value;
      index += option.consumed;
    } else if (
      arg === "--expected-document-sha256" ||
      arg.startsWith("--expected-document-sha256=")
    ) {
      const option = optionValue(args, index, "--expected-document-sha256");
      expectedDocumentSha256 = option.value;
      index += option.consumed;
    } else if (
      arg === "--expected-base" ||
      arg.startsWith("--expected-base=")
    ) {
      const option = optionValue(args, index, "--expected-base");
      expectedBaseStateSha256 = option.value;
      index += option.consumed;
    } else if (arg === "--stable-key" || arg.startsWith("--stable-key=")) {
      const option = optionValue(args, index, "--stable-key");
      stableKeys.push(option.value);
      index += option.consumed;
    } else {
      throw new Error(`unknown option or argument ${arg}`);
    }
  }

  if (!projectId || !projectVersionId) {
    throw new Error("--project and --version are required");
  }
  if (rawVerb === "import-vex" && action === "preview" && (!file || !vendor)) {
    throw new Error("import-vex preview requires <file> and --vendor NAME");
  }
  if (
    rawVerb === "import-vex" &&
    action === "apply" &&
    (!importId || !expectedDocumentSha256)
  ) {
    throw new Error(
      "import-vex apply requires --import-id and --expected-document-sha256 from preview",
    );
  }
  if (
    rawVerb === "import-vex" &&
    action === "preview" &&
    (importId !== null || expectedDocumentSha256 !== null)
  ) {
    throw new Error("import-vex preview does not accept apply inputs");
  }
  if (rawVerb === "import-vex" && action === "apply" && vendor !== null) {
    throw new Error("import-vex apply does not accept --vendor");
  }
  if (
    rawVerb !== "import-vex" &&
    (vendor !== null || file || importId || expectedDocumentSha256 !== null)
  ) {
    throw new Error("vendor import options are valid only for import-vex");
  }
  if (rawVerb !== "orphans" && stableKeys.length > 0) {
    throw new Error("--stable-key is valid only for orphan prune");
  }
  if (rawVerb === "orphans" && action === "prune") {
    if (stableKeys.length === 0 || !expectedBaseStateSha256) {
      throw new Error(
        "orphan prune requires --stable-key and --expected-base from a fresh orphan listing",
      );
    }
  }
  if (
    rawVerb === "orphans" &&
    action === "list" &&
    (stableKeys.length > 0 || expectedBaseStateSha256 !== null)
  ) {
    throw new Error("--stable-key and --expected-base require orphans prune");
  }
  if (rawVerb === "drift" && action === "refresh" && cursor !== null) {
    throw new Error("drift refresh does not accept --cursor");
  }
  if (rawVerb !== "drift" && (cursor !== null || limitSpecified)) {
    throw new Error("--cursor and --limit are valid only for drift reports");
  }
  if (rawVerb !== "orphans" && expectedBaseStateSha256 !== null) {
    throw new Error("--expected-base is valid only for orphan prune");
  }
  if (
    expectedBaseStateSha256 &&
    !/^[a-f0-9]{64}$/u.test(expectedBaseStateSha256)
  ) {
    throw new Error("--expected-base must be a lowercase SHA-256 digest");
  }
  if (
    expectedDocumentSha256 &&
    !/^[a-f0-9]{64}$/u.test(expectedDocumentSha256)
  ) {
    throw new Error(
      "--expected-document-sha256 must be a lowercase SHA-256 digest",
    );
  }
  return {
    help: false,
    input: {
      verb: rawVerb,
      action,
      projectId,
      projectVersionId,
      cursor,
      limit,
      json,
      file,
      vendor,
      importId,
      expectedDocumentSha256,
      expectedBaseStateSha256,
      stableKeys,
    },
  };
}

async function workspaceExecution(
  bb: BbPluginApi,
  context: PluginCliContext,
): Promise<WorkspaceExecution> {
  if (!context.threadId) {
    throw new Error(
      "FINDINGS_EXECUTION_CONTEXT_REQUIRED: invoke from a bb thread so the workspace and host are known",
    );
  }
  const thread = await bb.sdk.threads.get({ threadId: context.threadId });
  if (
    !thread.environmentId ||
    (context.projectId !== undefined && thread.projectId !== context.projectId)
  ) {
    throw new Error("FINDINGS_EXECUTION_CONTEXT_INVALID");
  }
  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });
  if (
    environment.projectId !== thread.projectId ||
    !environment.path ||
    !environment.hostId
  ) {
    throw new Error("FINDINGS_EXECUTION_CONTEXT_INVALID");
  }
  return {
    hostId: environment.hostId,
    root: environment.path,
    workspaceProjectId: thread.projectId,
  };
}

function confinedPath(root: string, file: string): string {
  if (isAbsolute(file)) {
    throw new Error("import-vex requires a worktree-relative file path");
  }
  const path = resolve(root, file);
  const rel = relative(root, path);
  if (
    rel === "" ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("import-vex file must stay within the current worktree");
  }
  return path;
}

function output(value: unknown, json: boolean): PluginCliResult {
  return {
    exitCode: 0,
    stdout: `${JSON.stringify(value, null, json ? 0 : 2)}\n`,
    stderr: "",
  };
}

const helpResult = (): PluginCliResult => ({
  exitCode: 0,
  stdout: `${TRIAGE_USAGE}\n`,
  stderr: "",
});

export function createFindingsCliRunner(
  bb: BbPluginApi,
  drift: FindingsDriftService,
  assertScope: ScopeAssertion,
): NamespacedCliRunner {
  return async (argv, context) => {
    const parsed = parseArgs(argv);
    if (parsed.help) return helpResult();
    const input = parsed.input;
    const execution = await workspaceExecution(bb, context);
    assertScope({
      workspaceProjectId: execution.workspaceProjectId,
      platformProjectId: input.projectId,
      projectVersionId: input.projectVersionId,
    });
    if (input.verb === "drift") {
      if (input.action === "report") {
        return output(
          drift.report({
            projectId: input.projectId,
            pvId: input.projectVersionId,
            cursor: input.cursor,
            limit: input.limit,
          }),
          input.json,
        );
      }
      return output(
        drift.refresh({
          root: execution.root,
          projectId: input.projectId,
          pvId: input.projectVersionId,
          limit: input.limit,
        }),
        input.json,
      );
    }
    if (input.verb === "orphans") {
      if (input.action === "list") {
        return output(
          drift.orphanState({
            projectId: input.projectId,
            pvId: input.projectVersionId,
          }),
          input.json,
        );
      }
      if (input.stableKeys.length > 500) {
        throw new Error(
          "ORPHAN_PRUNE_CHUNK_REQUIRED: submit at most 500 stable keys, then list orphans again and explicitly supply the refreshed digest for the next chunk",
        );
      }
      const result = await drift.pruneOrphans({
        root: execution.root,
        projectId: input.projectId,
        pvId: input.projectVersionId,
        stableKeys: input.stableKeys,
        expectedBaseStateSha256: input.expectedBaseStateSha256!,
      });
      return output(
        {
          selected: result.selected,
          pruned: result.pruned,
          files: [...result.files].sort(),
          chunks: 1,
          message: `Pruned ${result.pruned} of ${result.selected} selected orphaned decisions in one explicitly digest-fenced chunk.`,
        },
        input.json,
      );
    }

    if (input.action === "apply") {
      const result = await drift.applyVendorVex({
        root: execution.root,
        projectId: input.projectId,
        pvId: input.projectVersionId,
        importId: input.importId!,
        expectedDocumentSha256: input.expectedDocumentSha256!,
        overwrite: false,
      });
      return output(result, input.json);
    }
    const path = confinedPath(execution.root, input.file!);
    // rootPath is resolved on the owning host and rejects symlink escapes.
    const file = await bb.sdk.files.read({
      hostId: execution.hostId,
      path,
      rootPath: execution.root,
    });
    if (file.sizeBytes > MAX_VENDOR_VEX_BYTES) {
      throw new Error(
        `VENDOR_FILE_OVERSIZED: maximum ${MAX_VENDOR_VEX_BYTES} bytes`,
      );
    }
    const bytes =
      file.contentEncoding === "utf8"
        ? Buffer.from(file.content, "utf8")
        : Buffer.from(file.content, "base64");
    const staged = drift.stageVendorDocument({
      projectId: input.projectId,
      pvId: input.projectVersionId,
      file: input.file!,
      bytes,
    });
    return output(
      await drift.previewVendorVex({
        root: execution.root,
        projectId: input.projectId,
        pvId: input.projectVersionId,
        documentSha256: staged.documentSha256,
        vendor: input.vendor!,
      }),
      input.json,
    );
  };
}
