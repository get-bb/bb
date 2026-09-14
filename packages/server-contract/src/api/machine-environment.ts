import { z } from "zod";

export const machineEnvironmentNameSchema = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]*$/u)
  .max(128);
export const machineEnvironmentSetSchema = z
  .object({
    name: machineEnvironmentNameSchema,
    value: z
      .string()
      .max(65536)
      .refine(
        (value) => !value.includes("\0"),
        "Environment values cannot contain NUL",
      ),
    note: z.string().max(1024).nullable().default(null),
  })
  .strict();
export type MachineEnvironmentSet = z.infer<typeof machineEnvironmentSetSchema>;
export const machineEnvironmentVariableSchema = z
  .object({
    name: machineEnvironmentNameSchema,
    value: z.null(),
    secret: z.literal(true),
    note: z.string().nullable(),
  })
  .strict();
export type MachineEnvironmentVariable = z.infer<
  typeof machineEnvironmentVariableSchema
>;
export const machineEnvironmentListSchema = z.object({
  builtInGit: z.object({
    status: z.enum(["logged in", "not logged in", "overridden", "disabled"]),
    statusMessage: z.string(),
  }),
  variables: z.array(machineEnvironmentVariableSchema),
});
export type MachineEnvironmentList = z.infer<
  typeof machineEnvironmentListSchema
>;
