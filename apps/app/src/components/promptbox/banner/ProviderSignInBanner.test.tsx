// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderSignInBanner,
  resolveProviderSignInWarning,
} from "./ProviderSignInBanner";

afterEach(() => {
  cleanup();
});

describe("resolveProviderSignInWarning", () => {
  it("warns only when the provider is signed out or its session expired", () => {
    expect(
      resolveProviderSignInWarning({
        displayName: "Codex",
        status: "unauthenticated",
      }),
    ).toEqual({ displayName: "Codex", reason: "signedOut" });
    expect(
      resolveProviderSignInWarning({ displayName: "Codex", status: "expired" }),
    ).toEqual({ displayName: "Codex", reason: "expired" });
    for (const status of [
      "ready",
      "unknown",
      "not_installed",
      "unsupported_version",
    ] as const) {
      expect(
        resolveProviderSignInWarning({ displayName: "Codex", status }),
      ).toBeNull();
    }
    expect(resolveProviderSignInWarning(undefined)).toBeNull();
  });
});

describe("ProviderSignInBanner", () => {
  it("names the expired session and runs the sign-in action", () => {
    const onSignIn = vi.fn();
    render(
      <ProviderSignInBanner
        warning={{ displayName: "Claude Code", reason: "expired" }}
        onSignIn={onSignIn}
      />,
    );

    expect(
      screen.getByRole("region", {
        name: "Your Claude Code session expired",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Sign in to Claude Code to start a thread.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("omits the button when sign-in is unavailable for the machine", () => {
    render(
      <ProviderSignInBanner
        warning={{ displayName: "Codex", reason: "signedOut" }}
        onSignIn={null}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Codex isn't signed in" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
