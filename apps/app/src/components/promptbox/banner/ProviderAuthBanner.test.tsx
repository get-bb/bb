// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthBanner } from "./ProviderAuthBanner";

afterEach(() => {
  cleanup();
});

describe("ProviderAuthBanner", () => {
  it("offers a sign-in action for the failing provider", () => {
    const onSignIn = vi.fn();
    render(
      <ProviderAuthBanner
        displayName="Claude Code"
        loginCommand="claude /login"
        canSignIn
        signingIn={false}
        onSignIn={onSignIn}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Claude Code sign-in required" }),
    ).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "Sign in again to continue this thread.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in to Claude Code" }),
    );
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it("falls back to the login command when no terminal can be opened", () => {
    render(
      <ProviderAuthBanner
        displayName="Claude Code"
        loginCommand="claude /login"
        canSignIn={false}
        signingIn={false}
        onSignIn={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Run claude /login where this thread runs, then send again.",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disables the action while the sign-in terminal is opening", () => {
    render(
      <ProviderAuthBanner
        displayName="Claude Code"
        loginCommand="claude /login"
        canSignIn
        signingIn
        onSignIn={vi.fn()}
      />,
    );

    expect(
      (screen.getByRole("button", { name: "Opening…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
