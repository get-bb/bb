import { resolve } from "node:path";
import {
  createAgentSessionServices,
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
  type AgentSessionServices,
  type CreateAgentSessionServicesOptions,
  type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";

export type CreateConfiguredPiServicesOptions = Omit<
  CreateAgentSessionServicesOptions,
  "agentDir" | "cwd" | "resourceLoaderReloadOptions" | "settingsManager"
> & {
  agentDir?: string;
  cwd: string;
};

function resolveProjectTrusted(
  cwd: string,
  agentDir: string,
  settingsManager: SettingsManager,
): boolean {
  if (!hasTrustRequiringProjectResources(cwd)) {
    return true;
  }

  const savedDecision = new ProjectTrustStore(agentDir).get(cwd);
  if (savedDecision !== null) {
    return savedDecision;
  }

  // The bridge has no trust prompt. Pi treats an unresolved `ask` decision as
  // untrusted in every non-interactive mode, so BB must do the same.
  return settingsManager.getDefaultProjectTrust() === "always";
}

function formatResourceErrors(
  resourceType: string,
  diagnostics: ResourceDiagnostic[],
): string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.type === "error")
    .map(
      (diagnostic) =>
        `Failed to load Pi ${resourceType}${diagnostic.path ? ` "${diagnostic.path}"` : ""}: ${diagnostic.message}`,
    );
}

function collectServiceErrors(services: AgentSessionServices): string[] {
  const errors = services.diagnostics
    .filter((diagnostic) => diagnostic.type === "error")
    .map((diagnostic) => diagnostic.message);

  for (const settingsError of services.settingsManager.drainErrors()) {
    errors.push(
      `Failed to load ${settingsError.scope} Pi settings: ${settingsError.error.message}`,
    );
  }

  for (const extensionError of services.resourceLoader.getExtensions().errors) {
    errors.push(
      `Failed to load Pi extension "${extensionError.path}": ${extensionError.error}`,
    );
  }

  errors.push(
    ...formatResourceErrors(
      "skill",
      services.resourceLoader.getSkills().diagnostics,
    ),
    ...formatResourceErrors(
      "prompt",
      services.resourceLoader.getPrompts().diagnostics,
    ),
    ...formatResourceErrors(
      "theme",
      services.resourceLoader.getThemes().diagnostics,
    ),
  );

  return [...new Set(errors)];
}

export async function createConfiguredPiServices(
  options: CreateConfiguredPiServicesOptions,
): Promise<AgentSessionServices> {
  const cwd = resolve(options.cwd);
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: false,
  });
  settingsManager.setProjectTrusted(
    resolveProjectTrusted(cwd, agentDir, settingsManager),
  );

  const services = await createAgentSessionServices({
    ...options,
    agentDir,
    cwd,
    settingsManager,
  });
  const errors = collectServiceErrors(services);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return services;
}
