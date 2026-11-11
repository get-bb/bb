import {
  publicApiRoutes,
  type RegistrySkill,
  type RegistrySkillInstallJob,
} from "@bb/server-contract";
import type { OperationRoutes } from "../kernel/http-door.js";
import { ApiError } from "../errors.js";
import { createJobRegistry } from "../services/lib/job-registry.js";
import {
  githubRepoForSource,
  hasLoadableSkillContent,
  packageRefForSource,
  parsePageParameter,
  parsePerPageParameter,
  REGISTRY_SKILL_NAME_PATTERN,
  REGISTRY_SOURCE_PATTERN,
  hasUnsafePathSegment,
} from "../services/skills/registry-parse.js";
import {
  fetchRegistryRepositoryStars,
  fetchRegistrySkillDetail,
  listRegistrySkills,
  resolveRegistrySkillById,
} from "../services/skills/registry-proxy.js";
import { installServerRegistrySkill } from "../services/skills/registry-skill-install.js";
import type { AppDeps } from "../types.js";

export function registerSkillsRegistryRoutes(
  routes: OperationRoutes,
  deps: AppDeps,
): void {
  const contract = publicApiRoutes.skillsRegistry;
  async function proxyUpstream<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) throw error;
      deps.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "skills.sh registry fetch failed",
      );
      throw new ApiError(
        503,
        "skills_registry_unavailable",
        "skills.sh is unavailable",
      );
    }
  }

  routes.implement(contract.list, async ({ q, page, perPage }) =>
    proxyUpstream(() =>
      listRegistrySkills(
        q ?? "",
        parsePageParameter(page),
        parsePerPageParameter(perPage),
      ),
    ),
  );

  routes.implement(contract.entry, async ({ id }) => {
    if (id === undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected a registry skill ID",
      );
    }
    return proxyUpstream(() => resolveRegistrySkillById(id));
  });

  routes.implement(contract.entries, async ({ ids: requested }) => {
    const ids = [...new Set(requested)];
    const entries = (
      await Promise.all(
        ids.map(async (id): Promise<RegistrySkill | null> => {
          try {
            return await resolveRegistrySkillById(id);
          } catch {
            return null;
          }
        }),
      )
    ).filter((entry): entry is RegistrySkill => entry !== null);
    return { entries };
  });

  routes.implement(contract.repositoryStars, async ({ source }) => {
    if (
      source === undefined ||
      source.length === 0 ||
      source.length > 2_048 ||
      !REGISTRY_SOURCE_PATTERN.test(source) ||
      githubRepoForSource(source) === null
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected a valid GitHub repository source",
      );
    }
    const stars = await fetchRegistryRepositoryStars(source);
    if (stars === null) {
      throw new ApiError(
        503,
        "registry_repository_stars_unavailable",
        "GitHub repository stars are unavailable",
      );
    }
    return { stars };
  });

  routes.implement(contract.detail, async ({ source, skillId }) => {
    if (
      source === undefined ||
      source.length === 0 ||
      source.length > 2_048 ||
      !REGISTRY_SOURCE_PATTERN.test(source) ||
      hasUnsafePathSegment(source) ||
      skillId === undefined ||
      !REGISTRY_SKILL_NAME_PATTERN.test(skillId)
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected a valid source and skillId",
      );
    }
    const detail = await proxyUpstream(() =>
      fetchRegistrySkillDetail(source, skillId),
    );
    if (!hasLoadableSkillContent(detail)) {
      throw new ApiError(
        404,
        "registry_skill_unavailable",
        "Registry skill source is unavailable",
      );
    }
    return detail;
  });

  const installJobs = createJobRegistry<RegistrySkillInstallJob>({
    isActive: (job) => job.state === "running",
    fail: ({ id, registrySkillId }, error) => ({
      id,
      registrySkillId,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    }),
    notifyChanged: () => {},
  });

  async function startInstallJob(
    registrySkillId: string,
  ): Promise<RegistrySkillInstallJob> {
    const registrySkill = await resolveRegistrySkillById(registrySkillId);
    return installJobs.start({
      key: registrySkill.id,
      lane: registrySkill.id,
      create: (id) => ({
        id,
        registrySkillId: registrySkill.id,
        state: "running",
      }),
      run: async ({ job }) => {
        const result = await installServerRegistrySkill({
          dataDir: deps.config.dataDir,
          packageRef: packageRefForSource(registrySkill.source),
          registrySkillId: registrySkill.id,
          skillId: registrySkill.skillId,
        });
        return { ...job, state: "completed", filePath: result.filePath };
      },
    });
  }

  routes.implement(contract.install, async ({ registrySkillId }) => {
    const job = await startInstallJob(registrySkillId);
    const outcome = await installJobs.settled(job.id);
    if (outcome?.job.state !== "completed") throw outcome?.error;
    return { ok: true as const, filePath: outcome.job.filePath };
  });

  routes.implement(contract.installJobStart, async ({ registrySkillId }) => ({
    job: await startInstallJob(registrySkillId),
  }));

  routes.implement(contract.installJobGet, ({ jobId }) => {
    const job = installJobs.get(jobId);
    if (job === undefined) {
      throw new ApiError(
        404,
        "registry_skill_install_job_not_found",
        "Unknown skill install job; the server may have restarted",
      );
    }
    return { job };
  });
}
