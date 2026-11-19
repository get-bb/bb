import { BRIDGE_JSON_RPC_ERRORS } from "@bb/provider-bridge-protocol";
import { JsonRpcResponseError } from "@bb/provider-bridge-protocol/bridge-kit";
import { describe, expect, it } from "vitest";
import {
  CommandDispatchError,
  getErrorCode,
  isExpectedOnlineRpcFailureError,
} from "./command-dispatch-support.js";

describe("command dispatch support", () => {
  it("classifies a bridge missing-executable rejection without sniffing its message", () => {
    expect(
      getErrorCode(
        new JsonRpcResponseError(
          BRIDGE_JSON_RPC_ERRORS.MISSING_EXECUTABLE,
          "bb could not find the Codex CLI on this machine.",
        ),
      ),
    ).toBe("missing_executable");
    expect(
      getErrorCode(
        new JsonRpcResponseError(
          BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
          "bb could not find the Codex CLI on this machine.",
        ),
      ),
    ).toBe("command_failed");
  });

  it("classifies oversized file reads as expected RPC failures", () => {
    expect(
      isExpectedOnlineRpcFailureError(
        new CommandDispatchError("file_too_large", "File exceeds the limit"),
      ),
    ).toBe(true);
  });
});
