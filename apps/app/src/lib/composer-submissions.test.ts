import { describe, expect, it, vi } from "vitest";
import {
  notifyComposerSubmitted,
  subscribeComposerSubmitted,
} from "./composer-submissions";

describe("composer submissions", () => {
  it("scopes notifications and disposes listeners", () => {
    const listener = vi.fn();
    const dispose = subscribeComposerSubmitted(
      { kind: "thread", threadId: "one" },
      listener,
    );
    notifyComposerSubmitted({ kind: "thread", threadId: "two" });
    expect(listener).not.toHaveBeenCalled();
    notifyComposerSubmitted({ kind: "thread", threadId: "one" });
    expect(listener).toHaveBeenCalledOnce();
    dispose();
    notifyComposerSubmitted({ kind: "thread", threadId: "one" });
    expect(listener).toHaveBeenCalledOnce();
  });
});
