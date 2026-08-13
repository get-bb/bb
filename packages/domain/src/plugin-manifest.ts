import { z } from "zod";
import { uiCodeThemeDeclarationSchema } from "./code-theme.js";

const requiredManifestString = z.string().trim().min(1);

/**
 * `bb.branding.icon` accepts either a host icon name or an explicit
 * plugin-relative compact SVG path.
 */
export function isPluginOwnedIconPath(icon: string): boolean {
  return icon.startsWith("./");
}

export const pluginBrandingSchema = z
  .object({
    icon: requiredManifestString.optional(),
    logo: z
      .object({
        light: requiredManifestString,
        dark: requiredManifestString.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((branding, context) => {
    if (
      branding.icon !== undefined &&
      isPluginOwnedIconPath(branding.icon) &&
      !branding.icon.toLowerCase().endsWith(".svg")
    ) {
      context.addIssue({
        code: "custom",
        path: ["icon"],
        message:
          'plugin-owned branding.icon paths must point at an .svg file (for example "./assets/icon.svg")',
      });
    }
  })
  .refine(
    (branding) => branding.icon !== undefined || branding.logo !== undefined,
    {
      message: "must declare at least branding.icon or branding.logo.light",
    },
  );

export const pluginBbManifestSchema = z
  .object({
    name: requiredManifestString,
    description: requiredManifestString,
    branding: pluginBrandingSchema,
    server: requiredManifestString,
    app: requiredManifestString.optional(),
    skills: z.array(requiredManifestString).optional(),
    themes: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
              .max(64),
            name: requiredManifestString,
            description: requiredManifestString.optional(),
            css: requiredManifestString,
            codeTheme: uiCodeThemeDeclarationSchema.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const pluginPackageJsonSchema = z
  .object({
    name: requiredManifestString,
    version: requiredManifestString,
    engines: z
      .object({
        bb: requiredManifestString.optional(),
        bbPluginSdk: requiredManifestString.optional(),
      })
      .optional(),
    bb: pluginBbManifestSchema,
  })
  .passthrough();

export type PluginPackageJson = z.infer<typeof pluginPackageJsonSchema>;
