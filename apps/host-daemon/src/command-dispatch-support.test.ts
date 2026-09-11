import { CompetingTurnError } from "@bb/agent-runtime";
import { COMPETING_TURN_ERROR_CODE } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  CommandDispatchError,
  getErrorCode,
  isExpectedOnlineRpcFailureError,
} from "./command-dispatch-support.js";

describe("command dispatch support", () => {
  it("reports a runtime competing-turn refusal with the contract error code", () => {
    expect(getErrorCode(new CompetingTurnError("thread-1"))).toBe(
      COMPETING_TURN_ERROR_CODE,
    );
    expect(
      getErrorCode(
        new CommandDispatchError(
          COMPETING_TURN_ERROR_CODE,
          "Refusing to start a competing turn while thread-1 is still starting",
        ),
      ),
    ).toBe("competing_turn");
    expect(getErrorCode(new Error("Refusing to start a competing turn"))).toBe(
      "command_failed",
    );
  });

  it("classifies oversized file reads as expected RPC failures", () => {
    expect(
      isExpectedOnlineRpcFailureError(
        new CommandDispatchError("file_too_large", "File exceeds the limit"),
      ),
    ).toBe(true);
  });
});
