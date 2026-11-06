import {
  terminalListResponseSchema,
  terminalOutputResponseSchema,
  terminalSessionSchema,
} from "../api/terminals.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const terminalsOutputSchemas: GroupOutputSchemas<"terminals"> = {
  "terminals.list": terminalListResponseSchema,
  "terminals.create": terminalSessionSchema,
  "terminals.get": terminalSessionSchema,
  "terminals.update": terminalSessionSchema,
  "terminals.restart": terminalSessionSchema,
  "terminals.close": terminalSessionSchema,
  "terminals.input": terminalSessionSchema,
  "terminals.resize": terminalSessionSchema,
  "terminals.output": terminalOutputResponseSchema,
};
