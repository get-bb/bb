import { z } from "zod";
import {
  pendingInteractionRequestedPermissionProfileSchema,
  type PendingInteractionRequestedPermissionProfile,
} from "@get-bb/plugin-sdk/provider-bridge";

const nullableBooleanInputSchema = z
  .boolean()
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const nullableStringArrayInputSchema = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const nullableMacOsAccessInputSchema = z
  .enum(["none", "read_only", "read_write"])
  .nullable()
  .optional()
  .transform((value) => value ?? undefined);

const pendingInteractionPermissionNetworkInputSchema = z
  .object({
    enabled: nullableBooleanInputSchema,
  })
  .transform((value) => ({
    enabled: value.enabled ?? null,
  }));

const pendingInteractionPermissionFileSystemInputSchema = z
  .object({
    read: nullableStringArrayInputSchema,
    write: nullableStringArrayInputSchema,
  })
  .transform((value) => ({
    read: value.read ?? [],
    write: value.write ?? [],
  }));

const pendingInteractionPermissionMacOsBundleIdsInputSchema = z
  .object({
    bundleIds: nullableStringArrayInputSchema,
  })
  .transform((value) => ({
    kind: "bundle_ids" as const,
    bundleIds: value.bundleIds ?? [],
  }));

const pendingInteractionPermissionMacOsAutomationInputSchema = z
  .union([
    z.literal("none"),
    z.literal("all"),
    pendingInteractionPermissionMacOsBundleIdsInputSchema,
  ])
  .nullable()
  .optional()
  .transform((value) => {
    if (value === undefined || value === "none" || value === "all") {
      return value ?? "none";
    }

    return value;
  });

const pendingInteractionPermissionMacOsInputSchema = z
  .object({
    preferences: nullableMacOsAccessInputSchema,
    automations:
      pendingInteractionPermissionMacOsAutomationInputSchema.optional(),
    launchServices: nullableBooleanInputSchema,
    accessibility: nullableBooleanInputSchema,
    calendar: nullableBooleanInputSchema,
    reminders: nullableBooleanInputSchema,
    contacts: nullableMacOsAccessInputSchema,
  })
  .transform((value) => ({
    preferences: value.preferences ?? "none",
    automations: value.automations ?? "none",
    launchServices: value.launchServices ?? false,
    accessibility: value.accessibility ?? false,
    calendar: value.calendar ?? false,
    reminders: value.reminders ?? false,
    contacts: value.contacts ?? "none",
  }));

const pendingInteractionRequestedPermissionProfileInputSchema = z
  .object({
    network: pendingInteractionPermissionNetworkInputSchema
      .nullable()
      .optional(),
    fileSystem: pendingInteractionPermissionFileSystemInputSchema
      .nullable()
      .optional(),
    macos: pendingInteractionPermissionMacOsInputSchema.nullable().optional(),
  })
  .transform((value) => ({
    network: value.network ?? null,
    fileSystem: value.fileSystem ?? null,
    macos: value.macos ?? null,
  }));

type PendingInteractionRequestedPermissionProfileInput = z.input<
  typeof pendingInteractionRequestedPermissionProfileInputSchema
>;

export function normalizePendingInteractionRequestedPermissionProfile(
  input: PendingInteractionRequestedPermissionProfileInput,
): PendingInteractionRequestedPermissionProfile {
  return pendingInteractionRequestedPermissionProfileSchema.parse(
    pendingInteractionRequestedPermissionProfileInputSchema.parse(input),
  );
}
