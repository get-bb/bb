// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { PI_EXTENSION_UI_KIND } from "./src/extension-ui-contract.js";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

function render(
  data: unknown,
  handlers: {
    submit?: (value: unknown) => Promise<void>;
    cancel?: () => Promise<void>;
  } = {},
  payload: unknown = data,
) {
  return renderSlot(app.pendingInteractions[0]!, {
    interaction: {
      id: "pint_test",
      threadId: "thr_test",
      title: "Allow access?",
      payload: payload as never,
      createdAt: 0,
      expiresAt: null,
    },
    submit: handlers.submit ?? (async () => undefined),
    cancel: handlers.cancel ?? (async () => undefined),
  });
}

describe("pi extension ui interaction", () => {
  it("submits the chosen option label for a select dialog", async () => {
    const submit = vi.fn(async () => undefined);
    const view = render(
      { requestId: "ui-1", method: "select", options: ["Allow once", "Deny"] },
      { submit },
    );
    fireEvent.click(view.getByText("Allow once"));
    fireEvent.click(view.getByText("Submit"));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("Allow once"));
  });

  it("keeps submit disabled until a select option is chosen", () => {
    const view = render({
      requestId: "ui-1",
      method: "select",
      options: ["A", "B"],
    });
    expect((view.getByText("Submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(view.getByText("B"));
    expect((view.getByText("Submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("submits a boolean for a confirm dialog", async () => {
    const submit = vi.fn(async () => undefined);
    const view = render(
      { requestId: "ui-2", method: "confirm", message: "This modifies files." },
      { submit },
    );
    expect(view.getByText("This modifies files.")).toBeDefined();
    fireEvent.click(view.getByText("No"));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(false));
  });

  it("submits typed text for an input dialog", async () => {
    const submit = vi.fn(async () => undefined);
    const view = render(
      { requestId: "ui-3", method: "input", placeholder: "type here" },
      { submit },
    );
    fireEvent.change(view.getByPlaceholderText("type here"), {
      target: { value: "hello" },
    });
    fireEvent.click(view.getByText("Submit"));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("hello"));
  });

  it("renders editor prefill and submits the edited text", async () => {
    const submit = vi.fn(async () => undefined);
    const view = render(
      { requestId: "ui-4", method: "editor", prefill: "line one" },
      { submit },
    );
    const editor = view.container.querySelector("textarea")!;
    fireEvent.change(editor, { target: { value: "line one\nline two" } });
    fireEvent.click(view.getByText("Submit"));
    await vi.waitFor(() =>
      expect(submit).toHaveBeenCalledWith("line one\nline two"),
    );
  });

  it("renders the unwrapped payload the host passes to plugin components", async () => {
    const submit = vi.fn(async () => undefined);
    const view = render(
      { requestId: "ui-1", method: "select", options: ["Allow once", "Keep blocked"] },
      { submit },
    );
    fireEvent.click(view.getByText("Allow once"));
    fireEvent.click(view.getByText("Submit"));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("Allow once"));
  });

  it("still renders the wrapped stored-payload shape for robustness", async () => {
    const submit = vi.fn(async () => undefined);
    const view = render(
      undefined,
      { submit },
      {
        kind: PI_EXTENSION_UI_KIND,
        title: "Allow access?",
        data: { requestId: "ui-1", method: "select", options: ["A"] },
      },
    );
    fireEvent.click(view.getByText("A"));
    fireEvent.click(view.getByText("Submit"));
    await vi.waitFor(() => expect(submit).toHaveBeenCalledWith("A"));
  });

  it("offers cancel for an unrenderable payload", async () => {
    const cancel = vi.fn(async () => undefined);
    const view = render({ broken: true }, { cancel });
    expect(view.getByText(/could not be displayed/)).toBeDefined();
    fireEvent.click(view.getByText("Cancel"));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("offers cancel for a rendered dialog", async () => {
    const cancel = vi.fn(async () => undefined);
    const view = render(
      { requestId: "ui-1", method: "select", options: ["A"] },
      { cancel },
    );
    fireEvent.click(view.getByText("Cancel"));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
