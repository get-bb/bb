import { z } from "zod";

export const machineEnvironmentNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
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

export const machineEnvironmentDeleteSchema = machineEnvironmentSetSchema.pick({
  name: true,
});
export type MachineEnvironmentDelete = z.infer<
  typeof machineEnvironmentDeleteSchema
>;
export const projectMachineEnvironmentListSchema =
  machineEnvironmentListSchema.extend({
    inheritedVariables: z.array(machineEnvironmentVariableSchema),
  });
export type ProjectMachineEnvironmentList = z.infer<
  typeof projectMachineEnvironmentListSchema
>;
