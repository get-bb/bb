import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  fetchRegistrySkillDetail,
  hasLoadableSkillContent,
  isRecord,
  listRegistrySkills,
  packageRefForSource,
  parsePageParameter,
  parsePerPageParameter,
  REGISTRY_SKILL_NAME_PATTERN,
  REGISTRY_SOURCE_PATTERN,
  resolveRegistrySkillById,
} from "../services/skills/registry-proxy.js";
import { installServerRegistrySkill } from "../services/skills/registry-skill-install.js";
import type { AppDeps } from "../types.js";

export function registerSkillsRegistryRoutes(app: Hono, deps: AppDeps): void {
  app.get("/skills-registry", async (context) => {
    const query = context.req.query("q") ?? "";
    const page = parsePageParameter(context.req.query("page"));
    const perPage = parsePerPageParameter(context.req.query("perPage"));
    try {
      return context.json(await listRegistrySkills(query, page, perPage));
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
    return context.json(await resolveRegistrySkillById(id));
  });

  app.get("/skills-registry/detail", async (context) => {
    const source = context.req.query("source");
    const skillId = context.req.query("skillId");
    if (
      source === undefined ||
      source.length === 0 ||
      source.length > 2_048 ||
      !REGISTRY_SOURCE_PATTERN.test(source) ||
      skillId === undefined ||
      !REGISTRY_SKILL_NAME_PATTERN.test(skillId)
    ) {
      throw new ApiError(
        400,
        "invalid_request",
        "Expected a valid source and skillId",
      );
    }
    const detail = await fetchRegistrySkillDetail(source, skillId);
    if (!hasLoadableSkillContent(detail)) {
      throw new ApiError(
        404,
        "registry_skill_unavailable",
        "Registry skill source is unavailable",
      );
    }
    return context.json(detail);
  });

  app.post("/skills-registry/install", async (context) => {
    const body: unknown = await context.req.json().catch(() => null);
    const allowedKeys = new Set(["registrySkillId"]);
    if (
      !isRecord(body) ||
      Object.keys(body).some((key) => !allowedKeys.has(key)) ||
      typeof body.registrySkillId !== "string"
    ) {
      throw new ApiError(400, "invalid_request", "Expected registrySkillId");
    }
    const registrySkill = await resolveRegistrySkillById(body.registrySkillId);
    const result = await installServerRegistrySkill({
      dataDir: deps.config.dataDir,
      packageRef: packageRefForSource(registrySkill.source),
      registrySkillId: registrySkill.id,
      skillId: registrySkill.skillId,
    });
    return context.json({ ok: true, filePath: result.filePath });
  });
}
