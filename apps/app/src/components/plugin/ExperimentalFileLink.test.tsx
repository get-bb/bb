// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import { ExperimentalFileLink } from "./ExperimentalFileLink";

afterEach(cleanup);

const target = {
  kind: "workspace" as const,
  environmentId: "env_1",
  path: "src/example.ts",
};

describe("ExperimentalFileLink", () => {
  it("sends ordinary activation to the shared preview host", () => {
    const openFilePreview = vi.fn(() => true);
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <AppNavigationHostProvider capabilities={{ openFilePreview }}>
            <ExperimentalFileLink
              target={target}
              location={{ kind: "line", line: 12, column: 4 }}
            >
              example.ts:12
            </ExperimentalFileLink>
          </AppNavigationHostProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "example.ts:12" }));
    expect(openFilePreview).toHaveBeenCalledWith({
      target,
      location: { kind: "line", line: 12, column: 4 },
    });
  });

  it("leaves modifier clicks native", () => {
    const openFilePreview = vi.fn(() => true);
    render(
      <MemoryRouter>
        <AppNavigationHostProvider capabilities={{ openFilePreview }}>
          <ExperimentalFileLink target={target}>
            example.ts
          </ExperimentalFileLink>
        </AppNavigationHostProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "example.ts" }), {
      metaKey: true,
    });
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("uses a scheme-safe href for a valid scheme-like file name", () => {
    const openFilePreview = vi.fn(() => true);
    render(
      <MemoryRouter>
        <AppNavigationHostProvider capabilities={{ openFilePreview }}>
          <ExperimentalFileLink target={{ ...target, path: "vscode:foo" }}>
            vscode:foo
          </ExperimentalFileLink>
        </AppNavigationHostProvider>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "vscode:foo" });
    expect(link.getAttribute("href")).toBe("./vscode%3Afoo");

    fireEvent.click(link);
    expect(openFilePreview).toHaveBeenCalledWith({
      target: { ...target, path: "vscode:foo" },
      location: null,
    });
  });

  it("renders a malformed target supplied across a JavaScript boundary as inert", () => {
    const openFilePreview = vi.fn(() => true);
    render(
      <MemoryRouter>
        <AppNavigationHostProvider capabilities={{ openFilePreview }}>
          <ExperimentalFileLink target={{ ...target, path: "../secret" }}>
            invalid
          </ExperimentalFileLink>
        </AppNavigationHostProvider>
      </MemoryRouter>,
    );
    const invalid = screen.getByText("invalid");
    expect(screen.queryByRole("link", { name: "invalid" })).toBeNull();
    expect(invalid.getAttribute("href")).toBeNull();
    fireEvent.click(invalid);
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("renders a path with an unpaired UTF-16 surrogate as inert", () => {
    const openFilePreview = vi.fn(() => true);
    render(
      <MemoryRouter>
        <AppNavigationHostProvider capabilities={{ openFilePreview }}>
          <ExperimentalFileLink
            target={{ ...target, path: String.fromCharCode(0xd800) }}
          >
            invalid Unicode
          </ExperimentalFileLink>
        </AppNavigationHostProvider>
      </MemoryRouter>,
    );
    const invalid = screen.getByText("invalid Unicode");
    expect(screen.queryByRole("link", { name: "invalid Unicode" })).toBeNull();
    expect(invalid.getAttribute("href")).toBeNull();
    fireEvent.click(invalid);
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
