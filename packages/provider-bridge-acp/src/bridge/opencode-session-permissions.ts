import { execPortableFile } from "@bb/process-utils";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const OPENCODE_API_TIMEOUT_MS = 15_000;
const BB_MANAGED_ACTIONS = [
  "edit",
  "shell",
  "webfetch",
  "external_directory",
] as const;

const permissionRuleSchema = z
  .object({
    action: z.string(),
    resource: z.string(),
    effect: z.string(),
  })
  .passthrough();
type OpenCodePermissionRule = z.infer<typeof permissionRuleSchema>;

const sessionResponseSchema = z.object({
  data: z.object({
    permissions: z.array(permissionRuleSchema).optional(),
  }),
});

export function openCodeUsesSessionPermissions(
  agentVersion: string | undefined,
): boolean {
  const major = Number.parseInt(agentVersion?.split(".")[0] ?? "", 10);
  return Number.isInteger(major) && major >= 2;
}

export function bbOpenCodePermissionRules(
  permissionMode: "accept-edits" | "full",
): OpenCodePermissionRule[] {
  const effect = permissionMode === "full" ? "allow" : "ask";
  return BB_MANAGED_ACTIONS.map((action) => ({
    action,
    resource: "*",
    effect: action === "edit" ? "allow" : effect,
  }));
}

export function mergeOpenCodePermissionRules(
  current: readonly OpenCodePermissionRule[],
  permissionMode: "accept-edits" | "full",
): OpenCodePermissionRule[] {
  const managed = bbOpenCodePermissionRules(permissionMode);
  const isManaged = (rule: OpenCodePermissionRule): boolean =>
    rule.resource === "*" &&
    BB_MANAGED_ACTIONS.some((action) => action === rule.action);
  return [...managed, ...current.filter((rule) => !isManaged(rule))];
}

export async function applyOpenCodeSessionPermissions(args: {
  agentCommand: string;
  agentArgs: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  sessionId: string;
  permissionMode: "accept-edits" | "full";
}): Promise<void> {
  const sessionPath = `/api/session/${encodeURIComponent(args.sessionId)}`;
  if (args.agentArgs.at(-1) !== "acp") {
    throw new Error(
      `bb cannot apply its permission mode to OpenCode ${args.agentCommand} ${args.agentArgs.join(" ")}: the launch command must end with "acp".`,
    );
  }
  const api = (apiArgs: string[]) =>
    execPortableFile(
      args.agentCommand,
      [...args.agentArgs.slice(0, -1), "api", ...apiArgs],
      {
        cwd: args.cwd,
        env: args.env,
        maxBuffer: 4 * 1024 * 1024,
        timeout: OPENCODE_API_TIMEOUT_MS,
      },
    );
  const session = sessionResponseSchema.parse(
    JSON.parse((await api(["GET", sessionPath])).stdout),
  );
  const current = session.data.permissions ?? [];
  const permissions = mergeOpenCodePermissionRules(
    current,
    args.permissionMode,
  );
  if (isDeepStrictEqual(permissions, current)) {
    return;
  }
  await api(["PATCH", sessionPath, "-d", JSON.stringify({ permissions })]);
}
