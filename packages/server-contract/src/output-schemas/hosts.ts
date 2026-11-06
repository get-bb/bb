import { hostSchema } from "@bb/domain";
import { z } from "zod";
import {
  createHostJoinCodeResponseSchema,
  hostActionResponseSchema,
  hostCloneDefaultPathResponseSchema,
  hostDirectoryListingSchema,
  hostDiscoveredReposResponseSchema,
  hostEnrollmentCommandResponseSchema,
  hostPathsExistResponseSchema,
  hostPickFolderResponseSchema,
  hostProviderCliStatusResponseSchema,
  hostReconnectResponseSchema,
  hostRetryUpdateResponseSchema,
} from "../api/hosts.js";
import { deleteOldServerCopyResponseSchema } from "../api/server-move.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const hostsOutputSchemas: GroupOutputSchemas<"hosts"> = {
  "hosts.create": hostSchema,
  "hosts.createJoinCode": createHostJoinCodeResponseSchema,
  "hosts.list": z.array(hostSchema),
  "hosts.get": hostSchema.extend({
    connectMachineId: z.string().nullable(),
    threadStorageRootPath: z.string().nullable(),
  }),
  "hosts.enrollmentCommand": hostEnrollmentCommandResponseSchema,
  "hosts.reconnect": hostReconnectResponseSchema,
  "hosts.update": hostSchema,
  "hosts.updatePermissionCeiling": hostSchema,
  "hosts.retryUpdate": hostRetryUpdateResponseSchema,
  "hosts.reconcile": hostSchema,
  "hosts.suspend": hostSchema,
  "hosts.resume": hostSchema,
  "hosts.retryCleanup": hostActionResponseSchema,
  "hosts.delete": z.object({ ok: z.literal(true) }),
  "hosts.directory": hostDirectoryListingSchema,
  "hosts.discoveredRepos": hostDiscoveredReposResponseSchema,
  "hosts.file": null,
  "hosts.cloneDefaultPath": hostCloneDefaultPathResponseSchema,
  "hosts.pathsExist": hostPathsExistResponseSchema,
  "hosts.pickFolder": hostPickFolderResponseSchema,
  "hosts.providerCliStatus": hostProviderCliStatusResponseSchema,
  "hosts.providerCliInstall": null,
  "hosts.deleteOldServerCopy": deleteOldServerCopyResponseSchema,
};
