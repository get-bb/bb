// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { Icon } from "@bb/shared-ui/icon";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PageTitleHeader } from "./PageTitleHeader";
import { PageTitleHookHost, usePageTitleValue } from "./page-title";
import { useCorePageTitle } from "./core-page-title";

afterEach(cleanup);

describe("resource page title identity", () => {
  it.each([
    { path: "/skills", title: "Skills", icon: "Zap", leaf: "Browse" },
    {
      path: "/skills?view=library",
      title: "Skills",
      icon: "Zap",
      leaf: "My skills",
    },
    { path: "/plugins", title: "Plugins", icon: "Plug02", leaf: "Browse" },
    {
      path: "/plugins?view=installed",
      title: "Plugins",
      icon: "Plug02",
      leaf: "Installed",
    },
  ] as const)(
    "keeps $path identity fixed and collection text passive",
    ({ path, title, icon, leaf }) => {
      function Header() {
        const value = usePageTitleValue();
        return (
          <PageTitleHeader
            icon={<Icon name={icon} />}
            title={title}
            value={value}
          />
        );
      }
      const { wrapper } = createQueryClientTestHarness();
      const { container } = render(
        <MemoryRouter>
          <PageTitleHookHost usePageTitle={useCorePageTitle} subPath={path}>
            <Header />
          </PageTitleHookHost>
        </MemoryRouter>,
        { wrapper },
      );
      expect(screen.getAllByText(title)).toHaveLength(1);
      expect(screen.getByText(leaf)).toBeTruthy();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(container.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
    },
  );
});
