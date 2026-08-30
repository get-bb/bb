import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const RIFT_PROVIDER_ID = "acp-rift";

export const arcSessionOptionsSchema = z
  .object({
    arc: z
      .object({
        arcId: z.string().min(1).optional(),
        arcSize: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const routingSchema = z
  .object({
    providerId: z.string().min(1),
    hostId: z.string().min(1).optional(),
    environmentId: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !(value.hostId !== undefined && value.environmentId !== undefined),
    {
      message: "hostId and environmentId are mutually exclusive",
      path: ["hostId"],
    },
  );

export const arcBackendSchema = z.enum([
  "host",
  "apple-container",
  "fly",
  "docker",
  "firecracker",
]);
export const arcSizeSchema = z.enum([
  "a1.tiny",
  "a1.small",
  "a1.medium",
  "a1.large",
  "a1.xxlarge",
]);
export const arcStatusSchema = z.enum([
  "starting",
  "ready",
  "paused",
  "stopped",
  "error",
]);
const portalUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "Arc portal requires an HTTP(S) URL");
const portalSchema = z.object({ name: z.string(), url: portalUrlSchema }).strict();
export const arcSchema = z
  .object({
    arcId: z.string().min(1),
    hostId: z.string().min(1),
    backend: arcBackendSchema,
    provider: z.string().optional(),
    status: arcStatusSchema,
    workspaceRoot: z.string(),
    displayName: z.string().optional(),
    size: arcSizeSchema.optional(),
    image: z.string().optional(),
    threadId: z.string().optional(),
    projectId: z.string().optional(),
    repositoryUrl: z.string().optional(),
    portals: z.array(portalSchema).optional(),
    errorMessage: z.string().optional(),
    lastActivityAt: z.number().int(),
  })
  .strict();
export type Arc = z.infer<typeof arcSchema>;
export const arcResultSchema = arcSchema
  .extend({
    capabilities: z
      .object({
        start: z.boolean(),
        pause: z.boolean(),
        stop: z.boolean(),
        destroy: z.boolean(),
        portals: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type ArcResult = z.infer<typeof arcResultSchema>;
export const arcListResponseSchema = z
  .object({ data: z.array(arcResultSchema) })
  .strict();
export const accountStatusSchema = z
  .object({
    state: z.enum(["connected", "disconnected"]),
    accountId: z.string().optional(),
  })
  .strict();
export type AccountStatus = z.infer<typeof accountStatusSchema>;
const listInput = routingSchema;
const readInput = routingSchema.extend({ arcId: z.string().min(1) }).strict();
const createInput = routingSchema
  .extend({
    arcId: z.string().min(1).optional(),
    backend: arcBackendSchema,
    provider: z.string().optional(),
    size: arcSizeSchema,
    threadId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    repositoryUrl: z.string().optional(),
    portals: z.array(portalSchema).optional(),
    workspaceRoot: z.string(),
    displayName: z.string(),
    image: z.string(),
  })
  .strict();
const lifecycleInput = routingSchema
  .extend({
    arcId: z.string().min(1),
    action: z.enum(["start", "pause", "stop"]),
  })
  .strict();
const destroyInput = routingSchema
  .extend({ arcId: z.string().min(1) })
  .strict();
const spawnThreadInput = routingSchema
  .extend({
    arcId: z.string().min(1),
    projectId: z.string().min(1),
    prompt: z.string().min(1),
    title: z.string().min(1).optional(),
  })
  .strict();
const projectSummarySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    hostId: z.string().min(1),
    cwd: z.string().min(1),
  })
  .strict();
export const arcRpcContract = defineRpcContract({
  projects: {
    input: z.object({}).strict(),
    output: z.array(projectSummarySchema),
  },
  overview: {
    input: routingSchema,
    output: z
      .object({ account: accountStatusSchema, arcs: z.array(arcResultSchema) })
      .strict(),
  },
  authorize: { input: routingSchema, output: accountStatusSchema },
  list: { input: listInput, output: z.array(arcResultSchema) },
  read: { input: readInput, output: arcResultSchema },
  create: { input: createInput, output: arcResultSchema },
  lifecycle: { input: lifecycleInput, output: arcResultSchema },
  destroy: {
    input: destroyInput,
    output: z.object({ arcId: z.string() }).strict(),
  },
  spawnThread: {
    input: spawnThreadInput,
    output: z.object({ threadId: z.string() }).strict(),
  },
});
export const arcMethods = {
  list: "_riftar.cc/arc/list",
  read: "_riftar.cc/arc/read",
  create: "_riftar.cc/arc/create",
  start: "_riftar.cc/arc/start",
  pause: "_riftar.cc/arc/pause",
  stop: "_riftar.cc/arc/stop",
  destroy: "_riftar.cc/arc/destroy",
  accountStatus: "_riftar.cc/account/status",
  accountAuthorize: "_riftar.cc/account/authorize",
} as const;
export type ArcRouting = z.infer<typeof routingSchema>;
export type ArcCreateInput = z.infer<typeof createInput>;
export type ArcLifecycleInput = z.infer<typeof lifecycleInput>;
export type ArcReadInput = z.infer<typeof readInput>;
export type ArcDestroyInput = z.infer<typeof destroyInput>;
export type ArcSpawnThreadInput = z.infer<typeof spawnThreadInput>;
