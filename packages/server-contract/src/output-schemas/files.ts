import { hostDaemonOnlineRpcResultSchemaByType } from "@bb/host-daemon-contract";
import {
  createFilePreviewResponseSchema,
  hostFileReadResponseSchema,
} from "../api/files.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const filesOutputSchemas: GroupOutputSchemas<"files"> = {
  "files.read": hostFileReadResponseSchema,
  "files.write": hostDaemonOnlineRpcResultSchemaByType["host.write_file"],
  "files.list": hostDaemonOnlineRpcResultSchemaByType["host.list_files"],
  "files.listPaths": hostDaemonOnlineRpcResultSchemaByType["host.list_paths"],
  "files.mkdir": hostDaemonOnlineRpcResultSchemaByType["host.mkdir"],
  "files.move": hostDaemonOnlineRpcResultSchemaByType["host.move_path"],
  "files.remove": hostDaemonOnlineRpcResultSchemaByType["host.remove_path"],
  "files.createPreview": createFilePreviewResponseSchema,
};
