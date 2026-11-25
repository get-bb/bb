// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { lazyComponent } from "./lazy-component";
import {
  planReveal,
  registerLazyPart,
  useOrderedReveal,
  type LazyPart,
} from "./lazy-parts";

vi.unmock("react");
vi.unmock("./define-split");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function controlledPart(label: string) {
  let loaded = false;
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  function Entry() {
    return <p>{label}</p>;
  }
  const part: LazyPart = {
    load: () => done,
    isLoaded: () => loaded,
  };
  registerLazyPart(Entry, part);
  return {
    Entry,
    finish: async () => {
      loaded = true;
      finish();
      await act(async () => {
        await done;
      });
    },
  };
}

function eager(label: string): ComponentType {
  return function Eager() {
    return <p>{label}</p>;
  };
}

interface Entry {
  key: string;
  component: ComponentType;
}

const REVEAL = {
  key: (entry: Entry) => entry.key,
  parts: (entry: Entry) => [entry.component],
};

function Host({ entries }: { entries: readonly Entry[] }) {
  const revealed = useOrderedReveal(entries, REVEAL);
  return (
    <div data-testid="host">
      {revealed.map(({ key, component: Component }) => (
        <Component key={key} />
      ))}
    </div>
  );
}

function shownLabels(): string[] {
  return [...screen.getByTestId("host").querySelectorAll("p")].map(
    (node) => node.textContent ?? "",
  );
}

describe("ordered reveal", () => {
  it("holds every entry below a loading entry, bb's and plugins' alike, then reveals them together", async () => {
    const bbRows = controlledPart("bb rows");
    render(
      <Host
        entries={[
          { key: "core/rows", component: bbRows.Entry },
          { key: "git/branch/1", component: eager("git branch") },
        ]}
      />,
    );
    expect(shownLabels()).toEqual([]);

    await bbRows.finish();
    expect(shownLabels()).toEqual(["bb rows", "git branch"]);
  });

  it("keeps entries above a loading entry on screen while it loads", async () => {
    const pluginRows = controlledPart("plugin rows");
    render(
      <Host
        entries={[
          { key: "core/project", component: eager("project") },
          { key: "git/rows/1", component: pluginRows.Entry },
          { key: "other/rows/1", component: eager("other") },
        ]}
      />,
    );
    expect(shownLabels()).toEqual(["project"]);

    await pluginRows.finish();
    expect(shownLabels()).toEqual(["project", "plugin rows", "other"]);
  });

  it("stops holding after the bound, then inserts the late entry in its place when it arrives", async () => {
    vi.useFakeTimers();
    const slow = controlledPart("slow");
    render(
      <Host
        entries={[
          { key: "slow/rows/1", component: slow.Entry },
          { key: "git/rows/1", component: eager("git") },
        ]}
      />,
    );
    expect(shownLabels()).toEqual([]);

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(shownLabels()).toEqual(["git"]);

    await slow.finish();
    expect(shownLabels()).toEqual(["slow", "git"]);
  });

  it("still lets an eager entry that registers later appear in its place", () => {
    const view = render(
      <Host entries={[{ key: "git/rows/1", component: eager("git") }]} />,
    );
    view.rerender(
      <Host
        entries={[
          { key: "core/project", component: eager("project") },
          { key: "git/rows/1", component: eager("git") },
        ]}
      />,
    );
    expect(shownLabels()).toEqual(["project", "git"]);
  });

  it("plans entries below an expired loading entry as visible and keeps shown entries", () => {
    expect(
      planReveal(
        [
          { key: "late", ready: false },
          { key: "below", ready: true },
          { key: "held", ready: false },
          { key: "after", ready: true },
          { key: "kept", ready: true },
        ],
        {
          shown: new Set(["kept"]),
          expired: new Set(["late"]),
        },
      ),
    ).toEqual([false, true, false, false, true]);
  });
});

describe("experimental_lazy", () => {
  it("renders a part that loaded at idle in its first commit", async () => {
    const Panel = lazyComponent(async () => ({
      default: () => <p>panel</p>,
    }));
    await (Panel as unknown as { preload(): Promise<void> }).preload();

    render(<Panel />);
    expect(screen.getByText("panel")).toBeDefined();
  });

  it("crashes only its slot into onCrash when its chunk fails to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const Broken = lazyComponent<ComponentType>(() =>
      Promise.reject(new Error("Failed to fetch dynamically imported module")),
    );
    const onCrash = vi.fn();
    render(
      <>
        <PluginSlotMount
          pluginId="split"
          slotKind="threadInfoRow"
          slotId="rows"
          onCrash={onCrash}
        >
          <Broken />
        </PluginSlotMount>
        <p>sibling</p>
      </>,
    );

    await vi.waitFor(() => expect(onCrash).toHaveBeenCalledWith("split"));
    expect(screen.getByText("plugin split crashed")).toBeDefined();
    expect(screen.getByText("sibling")).toBeDefined();
  });
});
