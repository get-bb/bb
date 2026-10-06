import { TUNNEL_TARGET_HEADER } from "./protocol-headers.js";

export const RESP_HEAD_TIMEOUT_MS = 30_000;
export const VOICE_TRANSCRIPTION_RESP_HEAD_TIMEOUT_MS = 90_000;
const PLUGIN_OPERATION_RESP_HEAD_TIMEOUT_MS = 5 * 60_000;
const VOICE_TRANSCRIPTION_PATH = "/api/v1/system/voice-transcription";

export function responseHeadTimeoutMs(
  method: string,
  url: URL,
  headers: Headers,
): number {
  if (
    method === "POST" &&
    (url.pathname === "/api/v1/plugins/install" ||
      url.pathname === "/api/v1/plugin-catalog/install" ||
      /^\/api\/v1\/plugins\/[^/]+\/update$/.test(url.pathname))
  ) {
    return PLUGIN_OPERATION_RESP_HEAD_TIMEOUT_MS;
  }
  const target = headers.get(TUNNEL_TARGET_HEADER);
  return method === "POST" &&
    url.pathname === VOICE_TRANSCRIPTION_PATH &&
    (target === null || target === "")
    ? VOICE_TRANSCRIPTION_RESP_HEAD_TIMEOUT_MS
    : RESP_HEAD_TIMEOUT_MS;
}
