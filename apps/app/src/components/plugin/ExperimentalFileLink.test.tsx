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

  it("does not dispatch a malformed target supplied across a JavaScript boundary", () => {
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
    fireEvent.click(screen.getByRole("link", { name: "invalid" }));
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
