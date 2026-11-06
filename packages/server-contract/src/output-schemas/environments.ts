import { environmentSchema } from "@bb/domain";
import { z } from "zod";
import {
  environmentActionResponseSchema,
  environmentArchiveThreadsResponseSchema,
} from "../api/environments.js";
import { workspacePathListResponseSchema } from "../api/shared.js";
import type { GroupOutputSchemas } from "../public-operations.js";

const okSchema = z.object({ ok: z.literal(true) });

export const environmentsOutputSchemas: GroupOutputSchemas<"environments"> = {
  "environments.cleanup": okSchema,
  "environments.list": z.array(environmentSchema),
  "environments.delete": okSchema,
  "environments.get": environmentSchema,
  "environments.update": environmentSchema,
  "environments.paths": workspacePathListResponseSchema,
  "environments.file": null,
  "environments.revisionFile": null,
  "environments.actions": environmentActionResponseSchema,
  "environments.archiveThreads": environmentArchiveThreadsResponseSchema,
};
