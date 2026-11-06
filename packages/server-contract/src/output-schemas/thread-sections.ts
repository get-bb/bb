import {
  threadSectionMutationResponseSchema,
  threadSectionSchema,
} from "../api/projects.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const threadSectionsOutputSchemas: GroupOutputSchemas<"threadSections"> =
  {
    "threadSections.list": threadSectionSchema.array(),
    "threadSections.create": threadSectionSchema,
    "threadSections.update": threadSectionMutationResponseSchema,
    "threadSections.delete": threadSectionMutationResponseSchema,
  };
