// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppToastContent, appToast } from "./app-toast";

interface SonnerCustomOptions {
  duration?: number;
  id?: string | number;
}

interface CapturedToastOptions {
  duration?: number;
  id: string;
}

interface SonnerCustomToast {
  options: CapturedToastOptions;
  renderToast: (id: string | number) => ReactElement;
}

const sonnerToastState = vi.hoisted(() => {
  const invocations: SonnerCustomToast[] = [];
  return {
    custom: vi.fn(
      (
        renderToast: (id: string | number) => ReactElement,
        options?: SonnerCustomOptions,
      ) => {
        const fallbackId = `toast-${invocations.length + 1}`;
        const id =
          typeof options?.id === "string" || typeof options?.id === "number"
            ? String(options.id)
            : fallbackId;
        const toast = {
          options: {
            id,
            ...(typeof options?.duration === "number"
              ? { duration: options.duration }
              : {}),
          },
          renderToast,
        };
        invocations.push(toast);
        return id;
      },
    ),
    dismiss: vi.fn(),
    invocations,
  };
});

vi.mock("sonner", () => ({
  toast: {
    custom: sonnerToastState.custom,
    dismiss: sonnerToastState.dismiss,
  },
}));

afterEach(() => {
  cleanup();
  sonnerToastState.invocations.splice(0);
  sonnerToastState.custom.mockClear();
  sonnerToastState.dismiss.mockClear();
});

describe("appToast", () => {
  it("keeps loading toasts open until replaced or dismissed", () => {
    const toastId = appToast.loading("Creating commit");

    expect(toastId).toBe("toast-1");
    expect(sonnerToastState.custom).toHaveBeenCalledTimes(1);
    expect(sonnerToastState.invocations[0]?.options.duration).toBe(Infinity);
  });
});

describe("AppToastContent", () => {
  it("keeps a primary-action toast visible when the action prevents default", () => {
    render(
      <AppToastContent
        id="toast-1"
        tone="message"
        title="Commit failed"
        action={{
          label: "Ask agent to fix",
          onClick: (event) => event.preventDefault(),
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ask agent to fix" }));

    expect(sonnerToastState.dismiss).not.toHaveBeenCalled();
  });

  it("dismisses a primary-action toast by default", () => {
    render(
      <AppToastContent
        id="toast-1"
        tone="message"
        title="Desktop update ready"
        action={{
          label: "Relaunch",
          onClick: () => undefined,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Relaunch" }));

    expect(sonnerToastState.dismiss).toHaveBeenCalledWith("toast-1");
  });
});
