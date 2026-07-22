import { z } from "zod";

const requiredManifestString = z.string().trim().min(1);

/** Plugin-owned compact icons are explicit plugin-relative SVG assets. */
function isPluginOwnedIconPath(icon: string): boolean {
  return icon.startsWith("./");
}

export const pluginBrandingSchema = z
  .object({
    icon: requiredManifestString.optional(),
    experimental_icon: requiredManifestString.optional(),
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
    if (branding.icon !== undefined && isPluginOwnedIconPath(branding.icon)) {
      context.addIssue({
        code: "custom",
        path: ["icon"],
        message:
          'plugin-owned SVG paths must use branding.experimental_icon (for example "./assets/icon.svg")',
      });
    }
    if (
      branding.experimental_icon !== undefined &&
      !isPluginOwnedIconPath(branding.experimental_icon)
    ) {
      context.addIssue({
        code: "custom",
        path: ["experimental_icon"],
        message:
          'must be a plugin-relative path beginning with "./" (for example "./assets/icon.svg")',
      });
    }
    if (
      branding.experimental_icon !== undefined &&
      !branding.experimental_icon.toLowerCase().endsWith(".svg")
    ) {
      context.addIssue({
        code: "custom",
        path: ["experimental_icon"],
        message:
          'branding.experimental_icon must point at an .svg file (for example "./assets/icon.svg")',
      });
    }
  })
  .refine(
    (branding) =>
      branding.icon !== undefined ||
      branding.experimental_icon !== undefined ||
      branding.logo !== undefined,
    {
      message:
        "must declare at least branding.icon, branding.experimental_icon, or branding.logo.light",
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
