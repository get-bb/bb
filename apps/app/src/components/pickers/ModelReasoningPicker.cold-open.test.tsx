// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ModelReasoningPicker } from "./ModelReasoningPicker";

const menu = vi.hoisted(() => ({ imports: 0, release: () => {} }));
vi.mock("./ModelReasoningMenu", async (importOriginal) => {
  menu.imports += 1;
  await new Promise<void>((resolve) => {
    menu.release = resolve;
  });
  return importOriginal();
});

afterEach(cleanup);

it("keeps search typing and keyboard selection across the first menu download", async () => {
  const onModelChange = vi.fn();
  const { wrapper } = createQueryClientTestHarness();
  render(
    <ModelReasoningPicker
      providerOptions={[
        { value: "codex", label: "Codex", brandPrefix: "GPT-" },
      ]}
      selectedProviderId="codex"
      onSelectedProviderChange={() => {}}
      hasMultipleProviders={false}
      modelValue="gpt-5.5"
      modelOptions={[
        { value: "gpt-5.5", label: "GPT-5.5" },
        { value: "gpt-5.2", label: "GPT-5.2" },
        { value: "gpt-4.1", label: "GPT-4.1" },
        { value: "o3", label: "o3" },
        { value: "o4-mini", label: "o4-mini" },
        { value: "sonnet-in-codex", label: "Sonnet" },
      ]}
      moreModelOptions={[]}
      modelIsLoading={false}
      modelLoadError={null}
      onModelChange={onModelChange}
      reasoningValue="medium"
      reasoningOptions={[{ value: "medium", label: "Medium" }]}
      onReasoningChange={() => {}}
      fastModeEnabled={false}
      onFastModeChange={() => {}}
      showFastModeToggle={false}
      modal={false}
    />,
    { wrapper },
  );
  await act(async () => {});
  expect(menu.imports).toBe(0);
  fireEvent.click(
    screen.getByRole("button", { name: "Provider, model and reasoning" }),
  );
  const search = screen.getByPlaceholderText("Search models");
  await waitFor(() => expect(document.activeElement).toBe(search));
  expect(
    screen.getByRole("status", { name: "Loading model picker" }),
  ).toBeTruthy();
  fireEvent.change(search, { target: { value: "o4m" } });
  fireEvent.keyDown(search, { key: "ArrowDown" });
  expect(menu.imports).toBe(1);
  await act(async () => menu.release());
  expect(await screen.findByText("o4-mini")).toBeTruthy();
  expect(screen.queryByText("Sonnet")).toBeNull();
  expect(search).toHaveProperty("value", "o4m");
  expect(document.activeElement).toBe(search);
  fireEvent.keyDown(search, { key: "Enter" });
  expect(onModelChange).toHaveBeenCalledWith("o4-mini");
});
