import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const UNSUPPORTED_API_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bregisterTool\b/, "bb.agents.registerTool"],
  [/\bcontributeInstructions\b/, "bb.agents.contributeInstructions"],
  [
    /\bagents\s*\.\s*configure\b|\bconfigure\b[^;]{0,200}\}\s*=\s*[\w$.]*\bagents\b/,
    "bb.agents.configure",
  ],
  [
    /\bproviders\s*\.\s*register\b|\bregister\b[^;]{0,200}\}\s*=\s*[\w$.]*\bproviders\b/,
    "bb.providers.register",
  ],
  [/\bexperimental_contributeEnv/, "bb.providers.experimental_contributeEnv"],
  [/\bregisterMentionProvider\b/, "bb.ui.registerMentionProvider"],
  [/\bexperimental_hooks\b/, "bb.experimental_hooks"],
  [/\bexperimental_environments\b/, "bb.experimental_environments"],
  [/\bexperimental_machines\b/, "bb.experimental_machines"],
  [/\bexperimental_serverAccess\b/, "bb.experimental_serverAccess"],
  [/\bexperimental_aiServices\b/, "bb.experimental_aiServices"],
  [/\bexperimental_websocket\b/, "bb.http.experimental_websocket"],
  [/\bexperimental_client\b/, "bb.hosts.experimental_client"],
  [
    /\binternal_DO_NOT_USE_openTunnelIngress\b/,
    "bb.server.internal_DO_NOT_USE_openTunnelIngress",
  ],
  [
    /\binternal_DO_NOT_USE_(setNextTunnels|nextTunnelStatuses|onNextTunnelStatusChange)\b/,
    "bb.hosts next tunnel APIs",
  ],
  [/\bexperimental_schema\b/, "bb.settings.define experimental_schema"],
];

const RELATIVE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;

export async function findUnsupportedPluginServerApi(
  entryPath: string,
): Promise<string | null> {
  const pending = [resolve(entryPath)];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    let source: string;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const [pattern, member] of UNSUPPORTED_API_PATTERNS) {
      if (pattern.test(source)) return member;
    }
    for (const match of source.matchAll(RELATIVE_IMPORT)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        pending.push(resolve(dirname(file), specifier));
      }
    }
  }
  return null;
}
