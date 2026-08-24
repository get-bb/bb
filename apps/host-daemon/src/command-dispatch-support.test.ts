import { describe, expect, it } from "vitest";
import {
  CommandDispatchError,
  isExpectedOnlineRpcFailureError,
} from "./command-dispatch-support.js";

describe("command dispatch support", () => {
  it("classifies oversized file reads as expected RPC failures", () => {
    expect(
      isExpectedOnlineRpcFailureError(
        new CommandDispatchError("file_too_large", "File exceeds the limit"),
      ),
    ).toBe(true);
  });
});
