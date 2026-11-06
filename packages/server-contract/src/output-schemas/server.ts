import {
  serverMoveCheckResponseSchema,
  serverMoveStatusResponseSchema,
  serverMoveStatusSchema,
} from "../api/server-move.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const serverOutputSchemas: GroupOutputSchemas<"server"> = {
  "server.checkMove": serverMoveCheckResponseSchema,
  "server.startMove": serverMoveStatusSchema,
  "server.moveStatus": serverMoveStatusResponseSchema,
  "server.cancelMove": serverMoveStatusSchema,
  "server.export": null,
};
