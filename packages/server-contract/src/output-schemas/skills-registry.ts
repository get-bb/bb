import { registryRepositoryStarsResponseSchema } from "../api/plugin-routes.js";
import {
  registrySkillDetailSchema,
  registrySkillEntriesResponseSchema,
  registrySkillInstallResponseSchema,
  registrySkillSchema,
  registrySkillsPageSchema,
} from "../api/skills.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const skillsRegistryOutputSchemas: GroupOutputSchemas<"skillsRegistry"> =
  {
    "skillsRegistry.list": registrySkillsPageSchema,
    "skillsRegistry.entry": registrySkillSchema,
    "skillsRegistry.entries": registrySkillEntriesResponseSchema,
    "skillsRegistry.repositoryStars": registryRepositoryStarsResponseSchema,
    "skillsRegistry.detail": registrySkillDetailSchema,
    "skillsRegistry.install": registrySkillInstallResponseSchema,
  };
