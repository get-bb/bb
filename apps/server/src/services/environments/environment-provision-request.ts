import { z } from "zod";
import { environmentProvisionCommandSchema } from "@bb/host-daemon-contract";
import type { EnvironmentProvisionCommand } from "@bb/host-daemon-contract";

const environmentProvisionRequestBaseSchema = z.object({
  provisioningId: z.string().min(1),
});

export const directEnvironmentProvisionRequestSchema =
  environmentProvisionRequestBaseSchema.extend({
    mode: z.literal("direct"),
    command: environmentProvisionCommandSchema,
  });
export type DirectEnvironmentProvisionRequest = z.infer<
  typeof directEnvironmentProvisionRequestSchema
>;

export type EnvironmentProvisionRequest = DirectEnvironmentProvisionRequest;

export interface BuildDirectEnvironmentProvisionRequestArgs {
  command: EnvironmentProvisionCommand;
  provisioningId: string;
}

export function buildDirectEnvironmentProvisionRequest(
  args: BuildDirectEnvironmentProvisionRequestArgs,
): DirectEnvironmentProvisionRequest {
  return {
    mode: "direct",
    command: args.command,
    provisioningId: args.provisioningId,
  };
}
