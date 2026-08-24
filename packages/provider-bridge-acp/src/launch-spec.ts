/**
 * The ACP launch spec: how the bridge starts one agent. It travels inside the
 * registration's opaque `experimental_bridgeOptions.acpLaunchSpec` (static
 * options the runtime forwards untouched), so only the bridge — this package —
 * parses it. It is not a host-daemon wire field: the typed `acpLaunchSpec`
 * command field was deleted at protocol 155, and the shape now lives with
 * the bridge that reads it and the plugin that stores it (persisted plugin
 * settings for user-configured agents).
 *
 * This module is the package's `./launch-spec` subpath so the published SDK
 * can re-export the schema without pulling the bridge itself (its module
 * state and `node:sqlite` import) into every bridge's bundle.
 */
import {
  acpNativeReasoningSchema,
  acpPermissionCliSchema,
  acpReasoningCliSchema,
  normalizeProviderNativeRoots,
  providerNativeRootInputSchema,
  providerNativeRootsSchema,
} from "@bb/domain";
import { z } from "zod";

/**
 * The agent's own skill roots, in the declaration's input form: a path, or a
 * path with `recursive` / `ancestors` / `namePrefix`. Checked against the
 * domain's normalized rules (relative without dot segments, unique per
 * side, ancestors on project roots only) so the plugin setting
 * and the registration accept the same roots; the entries are kept as
 * written, since the declaration passes them through.
 */
const acpNativeSkillRootsSchema = z
  .object({
    user: z.array(providerNativeRootInputSchema).default([]),
    project: z.array(providerNativeRootInputSchema).default([]),
  })
  .strict()
  .superRefine((roots, context) => {
    const normalized = providerNativeRootsSchema.safeParse(
      normalizeProviderNativeRoots(roots),
    );
    if (normalized.success) {
      return;
    }
    for (const issue of normalized.error.issues) {
      context.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  });

export const acpLaunchSpecSchema = z
  .object({
    displayName: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string().min(1), z.string()),
    cwd: z.string().min(1).optional(),
    modelCli: z
      .object({
        listArgs: z.array(z.string()),
        selectFlag: z.string().min(1).optional(),
        primaryModels: z.array(z.string()),
      })
      .strict()
      .transform((modelCli) =>
        modelCli.listArgs.length > 0 ? modelCli : undefined,
      )
      .optional(),
    reasoningCli: acpReasoningCliSchema.optional(),
    nativeReasoning: acpNativeReasoningSchema.optional(),
    nativeSkillRoots: acpNativeSkillRootsSchema.optional(),
    permissionCli: acpPermissionCliSchema.optional(),
  })
  .strict();
export type AcpLaunchSpec = z.infer<
  typeof acpLaunchSpecSchema
>;

/**
 * The spec with its empty optional parts dropped: a `modelCli` that lists
 * nothing, a `permissionCli` that names no mode, and every absent field.
 * Two specs that launch the same agent then compare equal field by field,
 * which is what the SDK's `normalizeHostDaemonAcpLaunchSpec` (0.4.x) promised
 * a bridge; nothing in this repository keys on the normalized form any more.
 */
export function normalizeAcpLaunchSpec(spec: AcpLaunchSpec): AcpLaunchSpec {
  const {
    displayName,
    command,
    args,
    env,
    cwd,
    modelCli,
    reasoningCli,
    nativeReasoning,
    nativeSkillRoots,
    permissionCli,
  } = spec;
  const permissionCliHasMode =
    permissionCli?.full !== undefined ||
    permissionCli?.workspaceWrite !== undefined ||
    permissionCli?.readonly !== undefined;
  return {
    displayName,
    command,
    args,
    env,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(modelCli !== undefined && modelCli.listArgs.length > 0
      ? { modelCli }
      : {}),
    ...(reasoningCli !== undefined ? { reasoningCli } : {}),
    ...(nativeReasoning !== undefined ? { nativeReasoning } : {}),
    ...(nativeSkillRoots !== undefined ? { nativeSkillRoots } : {}),
    ...(permissionCli !== undefined && permissionCliHasMode
      ? { permissionCli }
      : {}),
  };
}
