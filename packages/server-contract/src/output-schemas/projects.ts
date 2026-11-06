import {
  projectExecutionDefaultsSchema,
  projectSourceSchema,
} from "@bb/domain";
import { z } from "zod";
import { projectMachineEnvironmentListSchema } from "../api/machine-environment.js";
import {
  commandListResponseSchema,
  projectBranchesResponseSchema,
  projectResponseSchema,
  projectWithThreadsResponseSchema,
  promptHistoryResponseSchema,
  sidebarBootstrapResponseSchema,
  skillContentResponseSchema,
  skillFilesResponseSchema,
  skillListResponseSchema,
  uploadedPromptAttachmentSchema,
} from "../api/projects.js";
import {
  workspaceFileListResponseSchema,
  workspacePathListResponseSchema,
} from "../api/shared.js";
import type { GroupOutputSchemas } from "../public-operations.js";

const okSchema = z.object({ ok: z.literal(true) });

export const projectsOutputSchemas: GroupOutputSchemas<"projects"> = {
  "projects.machineEnvironment": projectMachineEnvironmentListSchema,
  "projects.replaceMachineEnvironment": projectMachineEnvironmentListSchema,
  "projects.setMachineEnvironmentVariable": projectMachineEnvironmentListSchema,
  "projects.deleteMachineEnvironmentVariable":
    projectMachineEnvironmentListSchema,
  "projects.list": z.union([
    z.array(projectResponseSchema),
    z.array(projectWithThreadsResponseSchema),
  ]),
  "projects.create": projectResponseSchema,
  "projects.sidebarBootstrap": sidebarBootstrapResponseSchema,
  "projects.get": projectResponseSchema,
  "projects.update": projectResponseSchema,
  "projects.delete": okSchema,
  "projects.reorder": z.array(projectResponseSchema),
  "projects.defaultExecutionOptions": projectExecutionDefaultsSchema.nullable(),
  "projects.promptHistory": promptHistoryResponseSchema,
  "projects.createSource": projectSourceSchema,
  "projects.updateSource": projectSourceSchema,
  "projects.deleteSource": okSchema,
  "projects.files": workspaceFileListResponseSchema,
  "projects.file": null,
  "projects.hostFile": null,
  "projects.paths": workspacePathListResponseSchema,
  "projects.commands": commandListResponseSchema,
  "projects.skills": skillListResponseSchema,
  "projects.deleteSkill": z.object({ deletedPath: z.string() }),
  "projects.skillContent": skillContentResponseSchema,
  "projects.skillFiles": skillFilesResponseSchema,
  "projects.updateSkill": z.object({
    filePath: z.string(),
    revision: z.string(),
  }),
  "projects.branches": projectBranchesResponseSchema,
  "projects.branchOptions": projectBranchesResponseSchema,
  "projects.uploadAttachment": uploadedPromptAttachmentSchema,
  "projects.copyAttachments": okSchema,
  "projects.attachmentContent": null,
};
