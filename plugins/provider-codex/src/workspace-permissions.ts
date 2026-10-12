import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";

export const codexPermissionConfigSchema = z.object({
  config: z.object({
    default_permissions: z.string().nullish(),
    permissions: z
      .record(
        z.string(),
        z
          .object({
            extends: z.string().nullish(),
          })
          .passthrough(),
      )
      .nullish(),
  }),
});

export function configuredWorkspacePermissionProfile(
  config: z.infer<typeof codexPermissionConfigSchema>["config"],
): string | null {
  const profile = config.default_permissions;
  if (!profile || profile === ":workspace") return null;
  const visited = new Set<string>();
  let base = profile;
  while (base !== ":workspace" && base !== ":read-only") {
    if (base === ":danger-full-access") return null;
    if (visited.has(base) || !Object.hasOwn(config.permissions ?? {}, base)) {
      throw new Error(
        "Configured permissions profile has missing or cyclic inheritance.",
      );
    }
    visited.add(base);
    const parent = config.permissions?.[base]?.extends;
    if (!parent) return profile;
    base = parent;
  }
  if (base === ":read-only") {
    throw new Error(
      "Configured permissions are read-only; BB workspace modes require write access.",
    );
  }
  return profile;
}

function canonicalPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute
      ? absolute
      : join(canonicalPath(parent), basename(absolute));
  }
}

function containsPath(parent: string, child: string): boolean {
  const suffix = relative(parent, child);
  return (
    suffix === "" ||
    (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
  );
}

export function validateWorkspaceProfileSandbox(
  result: unknown,
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const parsed = z
    .object({
      sandbox: z.object({
        type: z.string(),
        writableRoots: z.array(z.string()).default([]),
      }),
    })
    .parse(result);
  if (parsed.sandbox.type === "readOnly") {
    throw new Error(
      "Configured permissions are read-only; BB workspace modes require write access.",
    );
  }
  if (parsed.sandbox.type !== "workspaceWrite") {
    throw new Error("Configured permissions exceed BB workspace isolation.");
  }
  const home = canonicalPath(env.HOME ?? homedir());
  const codexHome = canonicalPath(env.CODEX_HOME ?? join(home, ".codex"));
  for (const path of [cwd, ...parsed.sandbox.writableRoots]) {
    const root = canonicalPath(path);
    if (
      containsPath(root, home) ||
      containsPath(root, codexHome) ||
      containsPath(codexHome, root)
    ) {
      throw new Error(
        "Configured workspace roots permit writing the home directory or Codex configuration.",
      );
    }
  }
}
