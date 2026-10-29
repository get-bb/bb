import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Metafile } from "esbuild";

const GIT_READS_REPLACEMENT: Readonly<Record<string, string>> = {
  status:
    'bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "workspaceStatus", input: { environmentId, mergeBaseBranch } })',
  diff: 'bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "diff", input: { environmentId, target } })',
  diffFiles:
    'bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "files", input: { environmentId, target, ignoreWhitespace } })',
  diffPatch:
    'bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "patches", input: { keys } })',
  diffFile:
    'bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "fileSide", input: { environmentId, query } })',
  diffBranches:
    'bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "branches", input: { environmentId, query, limit } })',
};

const RETIRED_NAMES = "status|diff|diffFiles|diffPatch|diffFile|diffBranches";

const RETIRED_MEMBER_ACCESS = new RegExp(
  `\\benvironments\\s*\\??\\.\\s*(${RETIRED_NAMES})\\b`,
  "gu",
);
const RETIRED_BRACKET_ACCESS = new RegExp(
  `\\benvironments\\s*\\??\\.?\\s*\\[\\s*["'\`](${RETIRED_NAMES})["'\`]\\s*\\]`,
  "gu",
);
const ENVIRONMENTS_DESTRUCTURING =
  /\{([^{}]*)\}\s*=\s*[\w$.?\s]*\benvironments\b/gu;
const RETIRED_NAME = new RegExp(`^(?:${RETIRED_NAMES})$`, "u");

const PANEL_MEMBER_REPLACEMENTS: Readonly<Record<string, string>> = {
  openPanel:
    'ctx.openPanel is retired. Use ctx.experimental_panel.openTab({ tab: { id, context: { kind: "thread" }, availability: "action" }, params, title })',
  openThreadPanel:
    'useBbNavigate().openThreadPanel is retired. Use experimental_useAppPanel().openTab({ tab: { id: actionId, context: { kind: "thread" }, availability: "action" }, params, title })',
  experimental_openTab:
    "experimental_useAppPanel().experimental_openTab is retired. Use experimental_useAppPanel().openTab({ tab, target, params, title }) without surface",
  openFixedTab:
    'experimental_useAppPanel().openFixedTab is retired. Use experimental_useAppPanel().openTab({ tab: { id, context: { kind: "nav-panel", panelId }, availability: "fixed" }, target })',
};

const PANEL_MEMBER_NAMES = Object.keys(PANEL_MEMBER_REPLACEMENTS).join("|");
const RETIRED_PANEL_CALL = new RegExp(
  `\\.\\s*(${PANEL_MEMBER_NAMES})\\s*\\(`,
  "gu",
);
const RETIRED_PANEL_DESTRUCTURING = new RegExp(
  `\\{[^{}]*\\b(${PANEL_MEMBER_NAMES})\\b(?!\\s*:)[^{}]*\\}\\s*(?:\\)|=(?!=))`,
  "gu",
);

function retiredPanelMemberWarnings(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of [RETIRED_PANEL_CALL, RETIRED_PANEL_DESTRUCTURING]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return [...found].map(
    (name) =>
      `${PANEL_MEMBER_REPLACEMENTS[name]}. It keeps working only for existing plugins. See bb-plugin-authoring, frontend-hooks-and-ui.md#panel-controller.`,
  );
}

const RETIRED_RPC_INVALIDATES =
  /(?:^|[{,\s])["']?invalidates["']?\s*(?::|\([^()]*\)\s*(?::[^{};]*)?\{)/u;

export function retiredRpcInvalidatesWarnings(source: string): string[] {
  return RETIRED_RPC_INVALIDATES.test(source)
    ? [
        "invalidates on RPC contract methods is retired from the bb SDK typings and keeps working only for existing plugins. Delete it and call bb.rpc.experimental_invalidate(tags) in the server code that changes the data, so writes from RPC, the CLI, agent tools and background work each refresh matching reads once. See bb-plugin-authoring, frontend-hooks-and-ui.md#tags-and-invalidation.",
      ]
    : [];
}

export function retiredSdkMemberWarnings(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of [RETIRED_MEMBER_ACCESS, RETIRED_BRACKET_ACCESS]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  }
  for (const match of source.matchAll(ENVIRONMENTS_DESTRUCTURING)) {
    for (const binding of (match[1] ?? "").split(",")) {
      const name = binding.split(":")[0]?.trim() ?? "";
      if (RETIRED_NAME.test(name)) found.add(name);
    }
  }
  return [
    ...[...found].map(
      (name) =>
        `environments.${name} is retired from the bb SDK typings and keeps working only for existing plugins. Read through the Git plugin instead: ${GIT_READS_REPLACEMENT[name]}. See bb-plugin-authoring, git-reads.md.`,
    ),
    ...retiredPanelMemberWarnings(source),
  ];
}

export async function retiredSdkMemberWarningsForInputs(
  metafile: Metafile,
  absWorkingDir: string,
  pluginRoot: string,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const input of Object.keys(metafile.inputs)) {
    if (input.startsWith("(") || input.includes(":")) continue;
    if (input.includes("node_modules")) continue;
    const path = resolve(absWorkingDir, input);
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      continue;
    }
    const fromRoot = relative(pluginRoot, path);
    const ownSource = !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
    for (const warning of [
      ...retiredSdkMemberWarnings(source),
      ...(ownSource ? retiredRpcInvalidatesWarnings(source) : []),
    ]) {
      warnings.push(`${input}: ${warning}`);
    }
  }
  return warnings;
}
