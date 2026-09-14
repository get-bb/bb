// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Icon, preloadExtendedIcons } from "@bb/shared-ui/icon";
import { collectPluginAppRegistrations } from "@get-bb/plugin-sdk/internal/plugin-app-collector";
import type { ExperimentalIconRegistration } from "@get-bb/plugin-sdk/app";
import {
  beginPluginSlotBatch,
  getPluginSlotSnapshot,
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { pluginSdkAppImplementation } from "@/lib/plugin-sdk-app-impl";

function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} data-mark="one">
      <path d="M0 0h12v12z" />
    </svg>
  );
}

function OtherMark() {
  return <svg data-mark="two" />;
}

function registrations(...icons: ExperimentalIconRegistration[]) {
  return collectPluginAppRegistrations({
    __bbPluginApp: true,
    setup(app) {
      for (const icon of icons) app.experimental_icons.register(icon);
    },
  });
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

it("updates mounted host and SDK icons when plugins load, reload, and unload", () => {
  const SdkIcon = pluginSdkAppImplementation.experimental_Icon;
  const view = render(
    <>
      <Icon name="acme/receipt" fallback="Check" />
      <SdkIcon name="acme/receipt" fallback="Check" />
    </>,
  );
  expect(view.container.querySelectorAll('[data-icon="Check"]')).toHaveLength(
    2,
  );
  act(() =>
    setPluginSlotRegistrations(
      "acme",
      registrations({ name: "acme/receipt", component: Mark }),
    ),
  );
  expect(view.container.querySelectorAll('[data-mark="one"]')).toHaveLength(2);
  act(() =>
    setPluginSlotRegistrations(
      "acme",
      registrations({ name: "acme/receipt", component: OtherMark }),
    ),
  );
  expect(view.container.querySelectorAll('[data-mark="two"]')).toHaveLength(2);
  act(() => removePluginSlotRegistrations("acme"));
  expect(view.container.querySelectorAll('[data-icon="Check"]')).toHaveLength(
    2,
  );
});

it("overrides core and extended icons and restores them on removal", async () => {
  await preloadExtendedIcons();
  const view = render(
    <>
      <Icon name="Check" />
      <Icon name="FileText" />
    </>,
  );
  act(() =>
    setPluginSlotRegistrations(
      "overrides",
      registrations(
        { name: "Check", component: Mark },
        { name: "FileText", component: Mark },
      ),
    ),
  );
  expect(view.container.querySelectorAll('[data-mark="one"]')).toHaveLength(2);
  act(() => removePluginSlotRegistrations("overrides"));
  expect(view.container.querySelector("[data-mark]")).toBeNull();
  expect(view.container.querySelector('svg[data-icon="Check"]')).not.toBeNull();
  expect(
    view.container.querySelector('svg[data-icon="FileText"]'),
  ).not.toBeNull();
});

it("resolves collisions by plugin id, independent of arrival order, and restores the next owner", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  setPluginSlotRegistrations(
    "z-last",
    registrations({ name: "shared", component: OtherMark }),
  );
  const view = render(<Icon name="shared" />);
  act(() =>
    setPluginSlotRegistrations(
      "a-first",
      registrations({ name: "shared", component: Mark }),
    ),
  );
  expect(view.container.querySelector('[data-mark="one"]')).not.toBeNull();
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining('plugin z-last: icon "shared" ignored'),
  );
  act(() => removePluginSlotRegistrations("a-first"));
  expect(view.container.querySelector('[data-mark="two"]')).not.toBeNull();
});

it("uses registered fallbacks and terminates missing and recursive references", () => {
  const Recursive = () => <Icon name="loop" fallback="loop" />;
  setPluginSlotRegistrations(
    "icons",
    registrations(
      { name: "spare", component: Mark },
      { name: "loop", component: Recursive },
    ),
  );
  const view = render(
    <>
      <Icon name="missing" fallback="spare" />
      <Icon name="absent" fallback="absent" />
      <Icon name="loop" />
    </>,
  );
  expect(view.container.querySelector('[data-mark="one"]')).not.toBeNull();
  expect(view.container.querySelectorAll('svg[data-icon="Zap"]')).toHaveLength(
    2,
  );
});

it("rejects invalid registrations before replacing a live plugin", () => {
  setPluginSlotRegistrations(
    "icons",
    registrations({ name: "shared", component: Mark }),
  );
  const view = render(<Icon name="shared" />);
  expect(() => registrations({ name: " ", component: Mark })).toThrow();
  expect(() =>
    registrations(
      { name: "shared", component: Mark },
      { name: "shared", component: OtherMark },
    ),
  ).toThrow('duplicate icon name "shared"');
  expect(view.container.querySelector('[data-mark="one"]')).not.toBeNull();
});

it("contains a broken icon and recovers after its plugin replaces it", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Broken = () => {
    throw new Error("broken artwork");
  };
  setPluginSlotRegistrations(
    "broken",
    registrations({ name: "broken/mark", component: Broken }),
  );
  const view = render(
    <Icon name="broken/mark" aria-label="Example" className="size-4" />,
  );
  expect(view.container.querySelector('svg[data-icon="Zap"]')).not.toBeNull();
  act(() =>
    setPluginSlotRegistrations(
      "broken",
      registrations({ name: "broken/mark", component: Mark }),
    ),
  );
  expect(view.container.querySelector('[data-mark="one"]')).not.toBeNull();
  const wrapper = view.container.querySelector('[data-icon="broken/mark"]');
  expect(wrapper?.getAttribute("aria-label")).toBe("Example");
  expect(wrapper?.classList.contains("size-4")).toBe(true);
});

it("defers icon notifications until the slot batch commits, even when a render reads pending slots", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const icons = render(<Icon name="batch/icon" fallback="Check" />);
  const finish = beginPluginSlotBatch({ maxHoldMs: 1000 });
  setPluginSlotRegistrations(
    "batch",
    registrations({ name: "batch/icon", component: Mark }),
  );
  function ReadPendingSlots() {
    return <span>{getPluginSlotSnapshot().icons.length}</span>;
  }
  render(<ReadPendingSlots />);
  expect(error).not.toHaveBeenCalled();
  expect(icons.container.querySelector("[data-mark]")).toBeNull();
  act(finish);
  expect(icons.container.querySelector('[data-mark="one"]')).not.toBeNull();
});

it("remounts plugin artwork on a new generation even when the component function is unchanged", () => {
  let mounts = 0;
  function StatefulMark() {
    const [mount] = useState(() => ++mounts);
    return <svg data-mount={mount} />;
  }
  const registration = registrations({
    name: "stateful",
    component: StatefulMark,
  });
  setPluginSlotRegistrations("stateful", registration);
  const view = render(<Icon name="stateful" />);
  expect(view.container.querySelector("svg")?.getAttribute("data-mount")).toBe(
    "1",
  );
  act(() => setPluginSlotRegistrations("stateful", registration));
  expect(view.container.querySelector("svg")?.getAttribute("data-mount")).toBe(
    "2",
  );
});
