import type { ThreadEvent } from "@bb/domain";
import { getProviderModelFallbackData } from "./model-fallback-extraction.js";

export function threadEventJoinsRunningTurn(event: ThreadEvent): boolean {
  switch (event.type) {
    case "provider/modelFallback":
    case "provider/warning":
    case "system/interaction/lifecycle":
      return true;
    case "provider/unhandled":
      return getProviderModelFallbackData(event) !== null;
    default:
      return false;
  }
}
