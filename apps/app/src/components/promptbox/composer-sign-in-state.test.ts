import { describe, expect, it, vi } from "vitest";
import { resolveComposerSignInState } from "./composer-sign-in-state";

describe("resolveComposerSignInState", () => {
  it("puts the problem in the placeholder and offers Sign in", () => {
    const onSignIn = vi.fn();
    const state = resolveComposerSignInState(
      { displayName: "Codex", status: "unauthenticated" },
      onSignIn,
    );
    expect(state?.placeholder).toBe("Codex isn't signed in");
    expect(state?.blockedAction?.label).toBe("Sign in");
    state?.blockedAction?.onAction();
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("names an expired session", () => {
    expect(
      resolveComposerSignInState(
        { displayName: "Claude Code", status: "expired" },
        () => {},
      )?.placeholder,
    ).toBe("Your Claude Code session expired");
  });

  it("explains where to sign in when this app can't open the guide", () => {
    const state = resolveComposerSignInState(
      { displayName: "Codex", status: "unauthenticated" },
      null,
    );
    expect(state?.blockedAction).toBeUndefined();
    expect(state?.placeholder).toBe(
      "Codex isn't signed in on this thread's machine",
    );
  });

  it("stays out of the way for every other provider status", () => {
    for (const status of [
      "ready",
      "unknown",
      "not_installed",
      "unsupported_version",
    ] as const) {
      expect(
        resolveComposerSignInState({ displayName: "Codex", status }, () => {}),
      ).toBeNull();
    }
    expect(resolveComposerSignInState(undefined, () => {})).toBeNull();
  });
});
