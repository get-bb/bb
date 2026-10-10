import { z } from "zod";
import { versionLabel } from "./app-package.js";

export const CATALOG_FORMAT = "bb.playground-catalog/1";
export const catalogIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/,
    "Use owner/name in lowercase letters, digits, and dashes.",
  );
export const LICENSES = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MPL-2.0",
  "Unlicense",
  "CC0-1.0",
  "CC-BY-4.0",
] as const;
const relativePath = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/)
  .refine(
    (path) => !path.split("/").some((part) => part === ".." || part === ""),
    "Paths stay inside the catalog.",
  );
const catalogVersion = z
  .object({
    version: versionLabel,
    path: relativePath.refine((p) => p.endsWith(".json")),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z
      .number()
      .int()
      .min(2)
      .max(4 * 1024 * 1024),
    notes: z.string().max(1000).optional(),
    delisted: z.boolean().optional(),
  })
  .strict();
export const catalogListingSchema = z
  .object({
    id: catalogIdSchema,
    title: z.string().trim().min(1).max(160),
    summary: z.string().max(400),
    author: z
      .object({
        name: z.string().trim().min(1).max(80),
        url: z.string().url().startsWith("https://").max(300).optional(),
      })
      .strict(),
    license: z.enum(LICENSES),
    agentActions: z.enum(["documented", "manual"]),
    preview: relativePath
      .refine((p) => /\.(png|jpe?g|webp)$/.test(p))
      .optional(),
    delisted: z.boolean().optional(),
    screenshots: z
      .array(
        z
          .object({
            path: relativePath.refine((p) => /\.(png|jpe?g|webp)$/.test(p)),
            digest: z.string().regex(/^[0-9a-f]{64}$/),
            bytes: z
              .number()
              .int()
              .min(1)
              .max(600 * 1024),
            alt: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(4)
      .optional(),
    versions: z.array(catalogVersion).min(1).max(100),
  })
  .strict();
export const catalogIndexSchema = z
  .object({
    format: z.literal(CATALOG_FORMAT),
    revision: z
      .string()
      .regex(
        /^[0-9a-f]{40}([0-9a-f]{24})?$/,
        "Use the full Git commit ID the packages are published at.",
      ),
    packages: z
      .string()
      .url()
      .startsWith("https://")
      .max(300)
      .refine(
        (value) =>
          value.split("{revision}").length === 2 && value.endsWith("/"),
        "Use an https URL ending in / that contains {revision} once.",
      ),
    contributing: z.string().url().startsWith("https://").max(300).optional(),
    apps: z.array(catalogListingSchema).max(2000),
  })
  .strict();
export type CatalogIndex = z.infer<typeof catalogIndexSchema>;
export type CatalogListing = z.infer<typeof catalogListingSchema>;
export type CatalogVersion = z.infer<typeof catalogVersion>;

export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v.split(/[.+-]/).map((p) => Number.parseInt(p, 10));
  const pa = parts(a),
    pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isNaN(pa[i]!) ? 0 : (pa[i] ?? 0);
    const y = Number.isNaN(pb[i]!) ? 0 : (pb[i] ?? 0);
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
}

export function nextMinor(version: string | null): string {
  if (!version) return "1.0.0";
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return "1.0.0";
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

export function screenshotPath(
  catalogId: string,
  version: string,
  name: string,
) {
  return `apps/${catalogId}/${version}/${name}`;
}

export function packagePath(catalogId: string, version: string) {
  return `apps/${catalogId}/${version}.json`;
}
