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

/** Build Pi settings with the same saved and default project-trust policy. */
export function createConfiguredPiSettingsManager(
  cwd: string,
  agentDir: string,
): SettingsManager {
  const resolvedCwd = resolve(cwd);
  const resolvedAgentDir = resolve(agentDir);
  const settingsManager = SettingsManager.create(
    resolvedCwd,
    resolvedAgentDir,
    {
      projectTrusted: false,
    },
  );
  settingsManager.setProjectTrusted(
    resolveProjectTrusted(resolvedCwd, resolvedAgentDir, settingsManager),
  );
  return settingsManager;
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

export interface LoadedPiServices {
  /** Problems found in the user's Pi configuration. Empty when it is clean. */
  configErrors: string[];
  services: AgentSessionServices;
}

/**
 * Build the Pi services and report configuration problems instead of throwing.
 *
 * Pi keeps every resource it did load when one extension, skill, prompt, or
 * theme fails, so a caller that can work with a partial configuration should
 * report the errors and continue. A caller that cannot must use
 * {@link createConfiguredPiServices}.
 */
export async function loadConfiguredPiServices(
  options: CreateConfiguredPiServicesOptions,
): Promise<LoadedPiServices> {
  const cwd = resolve(options.cwd);
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const settingsManager = createConfiguredPiSettingsManager(cwd, agentDir);

  const services = await createAgentSessionServices({
    ...options,
    agentDir,
    cwd,
    settingsManager,
  });
  return { configErrors: collectServiceErrors(services), services };
}

/** Build the Pi services and fail on any configuration problem. */
export async function createConfiguredPiServices(
  options: CreateConfiguredPiServicesOptions,
): Promise<AgentSessionServices> {
  const { configErrors, services } = await loadConfiguredPiServices(options);
  if (configErrors.length > 0) {
    throw new Error(configErrors.join("\n"));
  }
  return services;
}
