import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const capacitySchema = z
  .object({
    availableParallelism: z.number().int().positive(),
    totalMemoryBytes: z.number().int().positive(),
  })
  .strict();

const hostMeasurementSchema = z
  .object({
    capacity: capacitySchema,
    oneMinuteLoad: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("measured"),
          value: z.number().nonnegative(),
        })
        .strict(),
      z.object({ kind: z.literal("unsupported") }).strict(),
    ]),
  })
  .strict();

export const machineMeasurementHostContract = defineRpcContract({
  measure: { input: z.null(), output: hostMeasurementSchema },
  checkSource: {
    input: z.object({ path: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("available") }).strict(),
      z.object({ kind: z.literal("missing") }).strict(),
      z.object({ kind: z.literal("failed"), reason: z.string() }).strict(),
    ]),
  },
});

const capacityObservationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("known"), capacity: capacitySchema }).strict(),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }).strict(),
]);

const freshReadingSchema = z
  .object({
    kind: z.literal("fresh"),
    oneMinuteLoad: z.number().nonnegative(),
    availableParallelism: z.number().int().positive(),
    requestedAt: z.number().int().nonnegative(),
  })
  .strict();

const loadReadingSchema = z.discriminatedUnion("kind", [
  freshReadingSchema,
  z.object({ kind: z.literal("unavailable"), reason: z.string() }).strict(),
]);

const hostNotReadyCodeSchema = z.enum([
  "ephemeral-host",
  "disconnected",
  "protocol-mismatch",
  "lifecycle-unavailable",
]);

const providerNotReadyCodeSchema = z.enum([
  "provider-not-offered",
  "provider-cli-missing",
  "provider-cli-unsupported",
  "provider-not-signed-in",
  "provider-sign-in-expired",
  "provider-readiness-unknown",
]);

const skipCodeSchema = z.enum([
  ...hostNotReadyCodeSchema.options,
  ...providerNotReadyCodeSchema.options,
  "no-project-source",
  "project-source-unavailable",
  "load-unavailable",
]);

const availabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("available") }).strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      code: hostNotReadyCodeSchema,
      reason: z.string(),
    })
    .strict(),
]);

const providerReadinessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }).strict(),
  z
    .object({
      kind: z.literal("not-ready"),
      code: providerNotReadyCodeSchema,
      label: z.string(),
      reason: z.string(),
    })
    .strict(),
]);

const machineProviderSchema = z
  .object({
    providerId: z.string().min(1),
    displayName: z.string().min(1),
    readiness: providerReadinessSchema,
  })
  .strict();

const providersObservationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reported"),
      providers: z.array(machineProviderSchema),
    })
    .strict(),
  z.object({ kind: z.literal("unavailable"), reason: z.string() }).strict(),
]);

const runningThreadSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    status: z.enum(["starting", "active"]),
    providerId: z.string(),
    providerName: z.string(),
    model: z.string().nullable(),
    runningSince: z.number().int().nonnegative(),
  })
  .strict();

const machineSchema = z
  .object({
    hostId: z.string().min(1),
    name: z.string(),
    isServer: z.boolean(),
    availability: availabilitySchema,
    capacity: capacityObservationSchema,
    load: loadReadingSchema,
    providers: providersObservationSchema,
    runningThreads: z.array(runningThreadSchema),
  })
  .strict();

const skipSchema = z
  .object({
    hostId: z.string().min(1),
    name: z.string(),
    code: skipCodeSchema,
    label: z.string(),
    reason: z.string(),
  })
  .strict();

const placementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-requested") }).strict(),
  z
    .object({
      kind: z.literal("chosen"),
      machine: z
        .object({
          hostId: z.string().min(1),
          name: z.string(),
          loadPerProcessor: z.number().nonnegative(),
          requestedAt: z.number().int().nonnegative(),
        })
        .strict(),
      reason: z.string(),
      skipped: z.array(skipSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stay-on-server"),
      reason: z.string(),
      skipped: z.array(skipSchema),
    })
    .strict(),
]);

const inspectInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z
    .object({
      kind: z.literal("placement"),
      projectId: z.string().min(1),
      providerId: z.string().min(1),
    })
    .strict(),
]);

const overviewSchema = z
  .object({
    inspectedAt: z.number().int().nonnegative(),
    machines: z.array(machineSchema),
    nextPickHostId: z.string().nullable(),
    pendingThreads: z.array(runningThreadSchema),
    placement: placementSchema,
  })
  .strict();

export const machineLoadBalancerRpcContract = defineRpcContract({
  inspect: { input: inspectInputSchema, output: overviewSchema },
});

export type Capacity = z.infer<typeof capacitySchema>;
export type CapacityObservation = z.infer<typeof capacityObservationSchema>;
export type LoadReading = z.infer<typeof loadReadingSchema>;
export type FreshReading = z.infer<typeof freshReadingSchema>;
export type Availability = z.infer<typeof availabilitySchema>;
export type HostNotReadyCode = z.infer<typeof hostNotReadyCodeSchema>;
export type ProviderNotReadyCode = z.infer<typeof providerNotReadyCodeSchema>;
export type ProviderReadiness = z.infer<typeof providerReadinessSchema>;
export type MachineProvider = z.infer<typeof machineProviderSchema>;
export type ProvidersObservation = z.infer<typeof providersObservationSchema>;
export type RunningThread = z.infer<typeof runningThreadSchema>;
export type Machine = z.infer<typeof machineSchema>;
export type Skip = z.infer<typeof skipSchema>;
export type SkipCode = z.infer<typeof skipCodeSchema>;
export type Placement = z.infer<typeof placementSchema>;
export type HostMeasurement = z.infer<typeof hostMeasurementSchema>;
export type InspectInput = z.infer<typeof inspectInputSchema>;
export type Overview = z.infer<typeof overviewSchema>;
