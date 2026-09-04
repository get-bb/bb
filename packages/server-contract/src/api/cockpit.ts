import { z } from "zod";
import {
  cockpitActionRequestSchema,
  cockpitDiscoverySchema,
  cockpitReceiptSchema,
} from "@bb/domain";

export const cockpitDiscoveryHttpQuerySchema = z.object({
  hostId: z.string().min(1).optional(),
});
export type CockpitDiscoveryHttpQuery = z.infer<
  typeof cockpitDiscoveryHttpQuerySchema
>;

export {
  cockpitActionRequestSchema,
  cockpitDiscoverySchema,
  cockpitReceiptSchema,
};
export type {
  CockpitActionRequest,
  CockpitDiscovery,
  CockpitReceipt,
} from "@bb/domain";
