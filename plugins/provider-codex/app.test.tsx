// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
const app = await loadPluginApp(() => import("./app.js"));
afterEach(cleanup);
const request = {
  serverName: "cua_repl",
  message: 'Allow Computer Use to use "bb"?',
  requestedSchema: { type: "object", properties: {} },
  metadata: {
    persist: ["session", "always"],
    riskLevel: "high",
    subtitle: "Can modify app data",
  },
};
function render(data: unknown, submit = vi.fn(async (_: unknown) => {})) {
  return {
    submit,
    view: renderSlot(app.pendingInteractions[0]!, {
      interaction: {
        id: "pint_test",
        threadId: "thr_test",
        title: "MCP request",
        payload: data as never,
        createdAt: 0,
        expiresAt: null,
      },
      submit,
      cancel: async () => {},
    }),
  };
}
it.each([
  [
    "Allow for this session",
    { action: "accept", content: {}, persist: "session" },
  ],
  ["Always allow", { action: "accept", content: {}, persist: "always" }],
  ["Decline", { action: "decline" }],
  ["Cancel", { action: "cancel" }],
])("requires a user click for %s", async (label, answer) => {
  const { view, submit } = render(request);
  expect(view.getByText(request.message)).toBeDefined();
  expect(view.getByText("Can modify app data")).toBeDefined();
  expect(view.getByText(/high/)).toBeDefined();
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: String(label) }));
  await vi.waitFor(() => expect(submit).toHaveBeenCalledWith(answer));
});
it("validates required fields before submitting typed input", async () => {
  const { view, submit } = render({
    ...request,
    metadata: null,
    requestedSchema: {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 1, maximum: 3 },
        confirmed: { type: "boolean" },
      },
      required: ["count", "confirmed"],
    },
  });
  fireEvent.click(view.getByRole("button", { name: "Accept" }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(view.getByLabelText("count"), { target: { value: "2" } });
  fireEvent.change(view.getByLabelText("confirmed"), {
    target: { value: "false" },
  });
  fireEvent.click(view.getByRole("button", { name: "Accept" }));
  await vi.waitFor(() =>
    expect(submit).toHaveBeenCalledWith({
      action: "accept",
      content: { count: 2, confirmed: false },
    }),
  );
});
it("shows submission errors without granting permission", async () => {
  const { view } = render(
    request,
    vi.fn(async () => {
      throw new Error("Connection lost");
    }),
  );
  fireEvent.click(view.getByRole("button", { name: "Decline" }));
  await vi.waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Connection lost"),
  );
});

it.each(["constructor", "toString"])(
  "does not answer an untouched boolean named %s",
  async (name) => {
    const { view, submit } = render({
      ...request,
      metadata: null,
      requestedSchema: {
        type: "object",
        properties: { [name]: { type: "boolean" } },
        required: [name],
      },
    });
    fireEvent.click(view.getByRole("button", { name: "Accept" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(view.getByLabelText(name), { target: { value: "false" } });
    fireEvent.click(view.getByRole("button", { name: "Accept" }));
    await vi.waitFor(() =>
      expect(submit).toHaveBeenCalledWith({
        action: "accept",
        content: { [name]: false },
      }),
    );
  },
);
