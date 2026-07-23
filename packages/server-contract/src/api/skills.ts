import { z } from "zod";
import { skillFilesResponseSchema, skillSummarySchema } from "./projects.js";

export const registrySkillSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  skillId: z.string().min(1),
  name: z.string().min(1),
  installs: z.number().int().nonnegative(),
  stars: z.number().int().nonnegative().nullable(),
  installUrl: z.string().url().nullable(),
  url: z.string().url(),
  topic: z.string().nullable(),
  summary: z.string().nullable(),
});
export type RegistrySkill = z.infer<typeof registrySkillSchema>;

export const registryPaginationSchema = z.object({
  page: z.number().int().nonnegative(),
  perPage: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});
export type RegistryPagination = z.infer<typeof registryPaginationSchema>;

export const registrySkillsPageSchema = z.object({
  skills: z.array(registrySkillSchema),
  pagination: registryPaginationSchema,
});
export type RegistrySkillsPage = z.infer<typeof registrySkillsPageSchema>;

export const registryRepositoryStarsSchema = z.object({
  stars: z.number().int().nonnegative(),
});
export type RegistryRepositoryStars = z.infer<
  typeof registryRepositoryStarsSchema
>;

export const registrySkillFileSchema = z.object({
  path: z.string().min(1),
  contents: z.string(),
});
export type RegistrySkillFile = z.infer<typeof registrySkillFileSchema>;

export const registrySkillDetailSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  skillId: z.string().min(1),
  hash: z.string().nullable(),
  files: z.array(registrySkillFileSchema).nullable(),
});
export type RegistrySkillDetail = z.infer<typeof registrySkillDetailSchema>;

export const librarySkillDetailPageSchema = z
  .object({
    kind: z.literal("library"),
    skill: skillSummarySchema,
    files: skillFilesResponseSchema.shape.files,
    filesTruncated: skillFilesResponseSchema.shape.truncated,
  })
  .strict();
export type LibrarySkillDetailPage = z.infer<
  typeof librarySkillDetailPageSchema
>;

export const registrySkillDetailPageSchema = z
  .object({
    kind: z.literal("registry"),
    skill: registrySkillSchema.extend({
      hash: z.string().nullable(),
      files: z.array(registrySkillFileSchema),
    }),
  })
  .strict();
export type RegistrySkillDetailPage = z.infer<
  typeof registrySkillDetailPageSchema
>;

/**
 * Canonical data models for the two Skills Hub detail pages. File contents
 * remain lazy for library skills so changing the selected file does not reload
 * page identity.
 */
export const skillDetailPageSchema = z.discriminatedUnion("kind", [
  librarySkillDetailPageSchema,
  registrySkillDetailPageSchema,
]);
export type SkillDetailPage = z.infer<typeof skillDetailPageSchema>;

export const registrySkillInstallRequestSchema = z
  .object({
    registrySkillId: z.string().min(1),
  })
  .strict();
export type RegistrySkillInstallRequest = z.infer<
  typeof registrySkillInstallRequestSchema
>;

export const registrySkillInstallResponseSchema = z.object({
  ok: z.literal(true),
  filePath: z.string().min(1),
});
export type RegistrySkillInstallResponse = z.infer<
  typeof registrySkillInstallResponseSchema
>;
