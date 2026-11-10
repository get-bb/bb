import type { Hono } from "hono";
import {
  registrySkillEntriesRequestSchema,
  registrySkillInstallRequestSchema,
  type RegistrySkill,
  type RegistrySkillInstallJob,
} from "@bb/server-contract";
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

export function registerSkillsRegistryRoutes(app: Hono, deps: AppDeps): void {
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

  app.get("/skills-registry", async (context) => {
    const query = context.req.query("q") ?? "";
    const page = parsePageParameter(context.req.query("page"));
    const perPage = parsePerPageParameter(context.req.query("perPage"));
    return context.json(
      await proxyUpstream(() => listRegistrySkills(query, page, perPage)),
    );
  });

  app.get("/skills-registry/entry", async (context) => {
    const id = context.req.query("id");
    if (id === undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected a registry skill ID",
      );
    }
    return context.json(
      await proxyUpstream(() => resolveRegistrySkillById(id)),
    );
  });

  app.post("/skills-registry/entries", async (context) => {
    const body = registrySkillEntriesRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!body.success) {
      throw new ApiError(400, "invalid_request", "Expected registry skill ids");
    }
    const ids = [...new Set(body.data.ids)];
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
    return context.json({ entries });
  });

  app.get("/skills-registry/repository-stars", async (context) => {
    const source = context.req.query("source");
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
    return context.json({ stars });
  });

  app.get("/skills-registry/detail", async (context) => {
    const source = context.req.query("source");
    const skillId = context.req.query("skillId");
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
    return context.json(detail);
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
    input: unknown,
  ): Promise<RegistrySkillInstallJob> {
    const body = registrySkillInstallRequestSchema.safeParse(input);
    if (!body.success) {
      throw new ApiError(400, "invalid_request", "Expected registrySkillId");
    }
    const registrySkill = await resolveRegistrySkillById(
      body.data.registrySkillId,
    );
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

  app.post("/skills-registry/install", async (context) => {
    const job = await startInstallJob(
      await context.req.json().catch(() => null),
    );
    const outcome = await installJobs.settled(job.id);
    if (outcome?.job.state !== "completed") throw outcome?.error;
    return context.json({ ok: true, filePath: outcome.job.filePath });
  });

  app.post("/skills-registry/install-jobs", async (context) => {
    const job = await startInstallJob(
      await context.req.json().catch(() => null),
    );
    return context.json({ job }, 202);
  });

  app.get("/skills-registry/install-jobs/:jobId", (context) => {
    const job = installJobs.get(context.req.param("jobId"));
    if (job === undefined) {
      throw new ApiError(
        404,
        "registry_skill_install_job_not_found",
        "Unknown skill install job; the server may have restarted",
      );
    }
    return context.json({ job });
  });
}
