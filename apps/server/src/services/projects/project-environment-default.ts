import type { ProjectEnvironmentDefault } from "@bb/domain";
import { setProjectEnvironmentDefault } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { getEnvironmentProvider } from "../plugins/plugin-environment-provider-registry.js";
import { parseProviderInputs } from "../threads/thread-environment-placement.js";

export async function saveProjectEnvironmentDefault(
  deps: Pick<AppDeps, "db" | "hub">,
  args: { projectId: string; value: ProjectEnvironmentDefault | null },
): Promise<void> {
  if (args.value === null) {
    setProjectEnvironmentDefault(deps.db, {
      projectId: args.projectId,
      value: null,
    });
    deps.hub.notifyProject(args.projectId, ["project-updated"]);
    return;
  }
  const { environmentProviderId } = args.value;
  const record = getEnvironmentProvider(environmentProviderId);
  if (record === undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      `Unknown environment provider "${environmentProviderId}". \`bb environment providers\` lists the providers a project can default to.`,
    );
  }
  if (record.provider.requires.projectless) {
    throw new ApiError(
      400,
      "invalid_request",
      `The "${environmentProviderId}" environment provider serves only threads that have no project.`,
    );
  }
  await parseProviderInputs(record, args.value.inputs);
  setProjectEnvironmentDefault(deps.db, {
    projectId: args.projectId,
    value: args.value,
  });
  deps.hub.notifyProject(args.projectId, ["project-updated"]);
}
