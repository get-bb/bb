import { resolveNativeApplicationIconDataUrl } from "./native-application-icon.js";
import type { DecodedInteractiveRequest } from "@get-bb/plugin-sdk/provider-bridge";
import {
  CODEX_MCP_ELICITATION_KIND,
  codexMcpElicitationSchema,
} from "./mcp-elicitation.js";

export async function resolveCodexMcpElicitationAppIcon(
  request: DecodedInteractiveRequest,
): Promise<DecodedInteractiveRequest> {
  if (request.payload.kind !== CODEX_MCP_ELICITATION_KIND) return request;
  const elicitation = codexMcpElicitationSchema.parse(request.payload.data);
  if (elicitation.kind !== "computer_use") return request;
  const iconDataUrl = await resolveNativeApplicationIconDataUrl(
    elicitation.app.id,
  ).catch(() => null);
  return {
    ...request,
    payload: {
      ...request.payload,
      data: {
        ...elicitation,
        app: { ...elicitation.app, iconDataUrl },
      },
    },
  };
}
