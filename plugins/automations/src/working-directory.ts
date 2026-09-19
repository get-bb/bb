import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AutomationScriptWorkingDirectory } from "./rpc-types.js";
import { scriptsRoot } from "./script-files.js";

const projectSourcesSchema = z
  .object({ sources: z.array(z.unknown()) })
  .passthrough();

const localPathProjectSourceSchema = z
  .object({
    type: z.literal("local_path"),
    hostId: z.string().min(1),
    path: z.string().min(1),
  })
  .passthrough();

export type ProjectsSdk = {
  get(
    args: Parameters<BbPluginApi["sdk"]["projects"]["get"]>[0],
  ): Promise<unknown>;
};

export type ScriptWorkingDirectoryResolver = (
  projectId: string,
  workingDirectory: AutomationScriptWorkingDirectory,
) => Promise<string | null>;

export function projectPathForHost(
  project: unknown,
  hostId: string,
): string | null {
  const parsed = projectSourcesSchema.safeParse(project);
  if (!parsed.success) return null;
  for (const source of parsed.data.sources) {
    const local = localPathProjectSourceSchema.safeParse(source);
    if (local.success && local.data.hostId === hostId) {
      return local.data.path;
    }
  }
  return null;
}

export function createScriptWorkingDirectoryResolver(args: {
  sdk: { projects: ProjectsSdk };
  pluginDataDir: string;
  serverHostId: string | null;
}): ScriptWorkingDirectoryResolver {
  const { sdk, pluginDataDir, serverHostId } = args;
  const projectPaths = new Map<string, Promise<string | null>>();
  return async (projectId, workingDirectory) => {
    if (workingDirectory.type === "automation-storage") {
      return scriptsRoot(pluginDataDir);
    }
    if (workingDirectory.type === "path") return workingDirectory.path;
    if (serverHostId === null) return null;
    let projectPath = projectPaths.get(projectId);
    if (projectPath === undefined) {
      projectPath = sdk.projects
        .get({ projectId })
        .then((project) => projectPathForHost(project, serverHostId));
      projectPaths.set(projectId, projectPath);
    }
    return projectPath;
  };
}
