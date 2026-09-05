// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import {
  codexMcpElicitationSchema,
  type CodexMcpElicitationResponse,
} from "./mcp-elicitation.js";
import { decodeCodexInteractiveRequest } from "./interactive-requests.js";
import computerUseElicitation from "./fixtures/computer-use-elicitation.json";

const app = await loadPluginApp(() => import("../app.js"));
const registration = app.pendingInteractions.find(
  (interaction) => interaction.id === "mcp-elicitation",
);
if (!registration) throw new Error("Missing Codex MCP elicitation renderer");

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const decoded = decodeCodexInteractiveRequest(computerUseElicitation);
if (!decoded || !("data" in decoded.payload)) {
  throw new Error(
    "Computer Use fixture did not decode as an extension request",
  );
}
const permission = codexMcpElicitationSchema.parse(decoded.payload.data);
if (permission.kind !== "computer_use")
  throw new Error("Expected Computer Use fixture");

function renderPermission(
  overrides: Partial<PluginPendingInteractionProps> = {},
  options: { openUrl?: (url: string) => boolean } = {},
) {
  return renderSlot(
    registration!,
    {
      interaction: {
        id: "pint_codex_permission",
        threadId: "thr_test",
        title: "App permission",
        payload: permission,
        createdAt: 0,
        expiresAt: null,
      },
      submit: vi.fn<PluginPendingInteractionProps["submit"]>(async () => {}),
      cancel: vi.fn<PluginPendingInteractionProps["cancel"]>(async () => {}),
      ...overrides,
    },
    options,
  );
}

const responses: {
  label: string;
  response: CodexMcpElicitationResponse;
}[] = [
  {
    label: "Allow for this session",
    response: { action: "accept", persist: "session" },
  },
  {
    label: "Always allow",
    response: { action: "accept", persist: "always" },
  },
  { label: "Decline", response: { action: "decline" } },
  { label: "Cancel", response: { action: "cancel" } },
];

describe("Codex app permission interaction", () => {
  it("shows the requested app, identity, and permission message", () => {
    const slot = renderPermission();

    expect(slot.getByText(permission.app.name)).toBeTruthy();
    expect(slot.getByText(permission.app.id)).toBeTruthy();
    expect(slot.getByText(permission.message)).toBeTruthy();
    expect(slot.getByText("Low risk")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Stop turn" })).toBeNull();
  });

  it("shows the native warning and high risk level", () => {
    const warning = "This app can access personal information.";
    const slot = renderPermission({
      interaction: {
        id: "pint_codex_permission",
        threadId: "thr_test",
        title: permission.message,
        payload: { ...permission, warning, riskLevel: "high" },
        createdAt: 0,
        expiresAt: null,
      },
    });

    expect(slot.getByText(warning)).toBeTruthy();
    expect(slot.getByText("High risk")).toBeTruthy();
    expect(slot.queryByText("Low risk")).toBeNull();
  });

  it("does not repeat the permission message used as the host heading", () => {
    const slot = renderPermission({
      interaction: {
        id: "pint_codex_permission",
        threadId: "thr_test",
        title: permission.message,
        payload: permission,
        createdAt: 0,
        expiresAt: null,
      },
    });

    expect(slot.queryByText(permission.message)).toBeNull();
    expect(slot.getByText(permission.app.name)).toBeTruthy();
  });

  it.each(responses)(
    "submits the exact $label response",
    ({ label, response }) => {
      const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
        async () => {},
      );
      const cancel = vi.fn<PluginPendingInteractionProps["cancel"]>(
        async () => {},
      );
      const slot = renderPermission({ submit, cancel });

      fireEvent.click(slot.getByRole("button", { name: label }));

      expect(submit).toHaveBeenCalledExactlyOnceWith(response);
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it.each(["session", "always"] as const)(
    "offers only the advertised %s scope",
    (scope) => {
      const slot = renderPermission({
        interaction: {
          id: "pint_codex_permission",
          threadId: "thr_test",
          title: permission.message,
          payload: { ...permission, scopes: [scope] },
          createdAt: 0,
          expiresAt: null,
        },
      });

      expect(
        slot.queryByRole("button", { name: "Allow for this session" }) !== null,
      ).toBe(scope === "session");
      expect(
        slot.queryByRole("button", { name: "Always allow" }) !== null,
      ).toBe(scope === "always");
    },
  );

  it.each(responses)(
    "disables every response while $label is pending",
    ({ label, response }) => {
      const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
        () => new Promise(() => {}),
      );
      const slot = renderPermission({ submit });

      fireEvent.click(slot.getByRole("button", { name: label }));
      for (const button of slot.getAllByRole("button")) {
        expect(button).toHaveProperty("disabled", true);
        fireEvent.click(button);
      }

      expect(slot.getByRole("status").textContent).toBe("Sending response…");
      expect(submit).toHaveBeenCalledExactlyOnceWith(response);
    },
  );

  it("shows submission failure and allows retry with another response", async () => {
    const submit = vi
      .fn<PluginPendingInteractionProps["submit"]>()
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce();
    const slot = renderPermission({ submit });

    fireEvent.click(slot.getByRole("button", { name: "Always allow" }));

    expect((await slot.findByRole("alert")).textContent).toBe(
      "Could not send this response. Try again or stop the turn.",
    );
    expect(slot.getByRole("button", { name: "Decline" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(slot.getByRole("button", { name: "Stop turn" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Decline" }));

    expect(submit.mock.calls).toEqual([
      [{ action: "accept", persist: "always" }],
      [{ action: "decline" }],
    ]);
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it.each([
    null,
    {},
    { ...permission, app: { name: permission.app.name } },
    { ...permission, scopes: ["forever"] },
    { ...permission, scopes: [] },
  ])("rejects an invalid payload without granting access", (payload) => {
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const cancel = vi.fn<PluginPendingInteractionProps["cancel"]>(
      async () => {},
    );
    const slot = renderPermission({
      interaction: {
        id: "pint_codex_permission",
        threadId: "thr_test",
        title: "App permission",
        payload,
        createdAt: 0,
        expiresAt: null,
      },
      submit,
      cancel,
    });

    expect(slot.getByRole("alert").textContent).toBe(
      "This request could not be displayed.",
    );
    expect(slot.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(slot.getByRole("button", { name: "Stop turn" }));

    expect(cancel).toHaveBeenCalledExactlyOnceWith();
    expect(submit).not.toHaveBeenCalled();
  });

  it("shows a stop failure and leaves the invalid request stoppable", async () => {
    const cancel = vi.fn<PluginPendingInteractionProps["cancel"]>(async () => {
      throw new Error("Disconnected");
    });
    const slot = renderPermission({
      interaction: {
        id: "pint_codex_permission",
        threadId: "thr_test",
        title: "App permission",
        payload: null,
        createdAt: 0,
        expiresAt: null,
      },
      cancel,
    });

    fireEvent.click(slot.getByRole("button", { name: "Stop turn" }));

    expect(
      await slot.findByText("Could not stop this turn. Try again."),
    ).toBeTruthy();
    expect(slot.getByRole("button", { name: "Stop turn" })).toHaveProperty(
      "disabled",
      false,
    );
  });
});

function formPayload(
  properties: Record<
    string,
    PluginPendingInteractionProps["interaction"]["payload"]
  >,
  required: string[] = [],
) {
  const request = decodeCodexInteractiveRequest({
    id: "form-test",
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thr_test",
      turnId: "turn_test",
      serverName: "example-service",
      mode: "form",
      message: "Provide your preferences",
      requestedSchema: { type: "object", properties, required },
    },
  });
  if (!request || !("data" in request.payload)) {
    throw new Error("Expected decoded form request");
  }
  const payload = codexMcpElicitationSchema.parse(request.payload.data);
  if (payload.kind !== "form")
    throw new Error("Expected supported form payload");
  return payload;
}

function renderPayload(
  payload: PluginPendingInteractionProps["interaction"]["payload"],
  options: {
    submit?: PluginPendingInteractionProps["submit"];
    cancel?: PluginPendingInteractionProps["cancel"];
    openUrl?: (url: string) => boolean;
  } = {},
) {
  return renderPermission(
    {
      interaction: {
        id: "pint_codex_generic",
        threadId: "thr_test",
        title: "MCP request",
        payload,
        createdAt: 0,
        expiresAt: null,
      },
      ...(options.submit ? { submit: options.submit } : {}),
      ...(options.cancel ? { cancel: options.cancel } : {}),
    },
    { openUrl: options.openUrl },
  );
}

const primitiveForm = () =>
  formPayload(
    {
      name: {
        type: "string",
        title: "Name",
        minLength: 1,
        description: "Your display name",
      },
      amount: { type: "number", title: "Amount", minimum: 0, maximum: 10 },
      count: { type: "integer", title: "Count", minimum: 1, maximum: 5 },
      enabled: { type: "boolean", title: "Enabled" },
      color: {
        type: "string",
        title: "Color",
        oneOf: [
          { const: "red", title: "Red" },
          { const: "blue", title: "Blue" },
        ],
      },
      tags: {
        type: "array",
        title: "Tags",
        minItems: 1,
        maxItems: 2,
        items: { type: "string", enum: ["work", "personal", "shared"] },
      },
    },
    ["name", "amount", "count", "enabled", "color", "tags"],
  );

describe("Codex MCP forms", () => {
  it("renders and submits each primitive with its native value type", () => {
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const slot = renderPayload(primitiveForm(), { submit });

    expect(slot.getByText("example-service")).toBeTruthy();
    expect(slot.getByText("Your display name")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(slot.getByLabelText("Amount"), {
      target: { value: "2.5" },
    });
    fireEvent.change(slot.getByLabelText("Count"), { target: { value: "3" } });
    fireEvent.click(
      within(slot.getByRole("radiogroup", { name: "Enabled" })).getByRole(
        "radio",
        { name: "No" },
      ),
    );
    fireEvent.click(
      within(slot.getByRole("radiogroup", { name: "Color" })).getByRole(
        "radio",
        { name: "Blue" },
      ),
    );
    fireEvent.click(slot.getByRole("checkbox", { name: "work" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "shared" }));
    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));

    expect(submit).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: {
        name: "Ada",
        amount: 2.5,
        count: 3,
        enabled: false,
        color: "blue",
        tags: ["work", "shared"],
      },
    });
    for (const input of slot.getAllByRole("textbox"))
      expect(input).toHaveProperty("disabled", true);
    for (const checkbox of slot.getAllByRole("checkbox"))
      expect(checkbox).toHaveProperty("disabled", true);
    for (const radio of slot.getAllByRole("radio"))
      expect(radio).toHaveProperty("disabled", true);
  });

  it("uses explicit defaults while leaving other optional values absent", () => {
    const payload = formPayload({
      name: { type: "string", title: "Name", default: "Ada" },
      count: { type: "integer", title: "Count", default: 0 },
      enabled: { type: "boolean", title: "Enabled", default: false },
      color: {
        type: "string",
        title: "Color",
        enum: ["red", "blue"],
        default: "blue",
      },
      tags: {
        type: "array",
        title: "Tags",
        items: { type: "string", enum: ["work", "personal"] },
        default: ["work"],
      },
      note: { type: "string", title: "Note" },
      amount: { type: "number", title: "Amount" },
      optionalFlag: { type: "boolean", title: "Optional flag" },
    });
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const slot = renderPayload(payload, { submit });

    expect(slot.getByLabelText("Count")).toHaveProperty("value", "0");
    expect(
      within(slot.getByRole("radiogroup", { name: "Optional flag" }))
        .getAllByRole("radio")
        .every((radio) => radio.getAttribute("aria-checked") === "false"),
    ).toBe(true);
    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));

    expect(submit).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: {
        name: "Ada",
        count: 0,
        enabled: false,
        color: "blue",
        tags: ["work"],
      },
    });
  });

  it("clears optional false and numeric defaults instead of replacing them", () => {
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const slot = renderPayload(
      formPayload({
        enabled: { type: "boolean", title: "Enabled", default: false },
        count: { type: "number", title: "Count", default: 3 },
      }),
      { submit },
    );

    fireEvent.click(slot.getByRole("button", { name: "Clear Enabled" }));
    fireEvent.change(slot.getByLabelText("Count"), { target: { value: "" } });
    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));

    expect(submit).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: {},
    });
  });

  it("shows field errors for missing required answers without inventing boolean or number values", () => {
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const slot = renderPayload(primitiveForm(), { submit });

    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));

    expect(submit).not.toHaveBeenCalled();
    expect(slot.getAllByRole("alert")).toHaveLength(6);
    expect(slot.getByLabelText("Amount").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(
      slot
        .getByRole("radiogroup", { name: "Enabled" })
        .getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("shows shared validation errors for numeric, string, format, and selection constraints", () => {
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const payload = formPayload({
      email: { type: "string", title: "Email", format: "email" },
      name: { type: "string", title: "Name", minLength: 3, maxLength: 5 },
      amount: { type: "number", title: "Amount", minimum: 1, maximum: 3 },
      count: { type: "integer", title: "Count" },
      tags: {
        type: "array",
        title: "Tags",
        minItems: 2,
        maxItems: 2,
        items: { type: "string", enum: ["a", "b", "c"] },
      },
    });
    const slot = renderPayload(payload, { submit });
    fireEvent.change(slot.getByLabelText("Email"), {
      target: { value: "invalid" },
    });
    fireEvent.change(slot.getByLabelText("Name"), { target: { value: "ab" } });
    fireEvent.change(slot.getByLabelText("Amount"), { target: { value: "4" } });
    fireEvent.change(slot.getByLabelText("Count"), {
      target: { value: "1.5" },
    });
    fireEvent.click(slot.getByRole("checkbox", { name: "a" }));
    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));

    expect(submit).not.toHaveBeenCalled();
    expect(slot.getAllByRole("alert")).toHaveLength(5);
    fireEvent.change(slot.getByLabelText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(slot.getByLabelText("Name"), { target: { value: "Ada" } });
    fireEvent.change(slot.getByLabelText("Amount"), {
      target: { value: "2.5" },
    });
    fireEvent.change(slot.getByLabelText("Count"), { target: { value: "1" } });
    fireEvent.click(slot.getByRole("checkbox", { name: "b" }));
    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));

    expect(slot.queryByRole("alert")).toBeNull();
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: {
        email: "ada@example.com",
        name: "Ada",
        amount: 2.5,
        count: 1,
        tags: ["a", "b"],
      },
    });
  });

  it("retries a failed submission with the edited field values", async () => {
    const submit = vi
      .fn<PluginPendingInteractionProps["submit"]>()
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce();
    const slot = renderPayload(
      formPayload({ name: { type: "string", title: "Name" } }, ["name"]),
      { submit },
    );
    fireEvent.change(slot.getByLabelText("Name"), {
      target: { value: "First" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));
    await slot.findByRole("alert");
    fireEvent.change(slot.getByLabelText("Name"), {
      target: { value: "Second" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Submit response" }));

    expect(submit.mock.calls).toEqual([
      [{ action: "accept", content: { name: "First" } }],
      [{ action: "accept", content: { name: "Second" } }],
    ]);
  });
});

const urlPayload = {
  kind: "url",
  serverName: "example-service",
  message: "Connect your account",
  url: "https://example.com/authorize?request=test",
  elicitationId: "auth-test",
};

describe("Codex MCP URL requests", () => {
  it("shows the destination and opens only after consent, before submitting acceptance", () => {
    const openUrl = vi.fn(() => true);
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const slot = renderPayload(urlPayload, { openUrl, submit });

    expect(slot.getByText(urlPayload.url)).toBeTruthy();
    expect(slot.getByText("example-service")).toBeTruthy();
    expect(openUrl).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Open example.com" }));

    expect(openUrl).toHaveBeenCalledExactlyOnceWith(urlPayload.url);
    expect(submit).toHaveBeenCalledExactlyOnceWith({ action: "accept" });
    expect(openUrl.mock.invocationCallOrder[0]).toBeLessThan(
      submit.mock.invocationCallOrder[0]!,
    );
  });

  it.each(["Decline", "Cancel"])(
    "returns %s without opening the URL or stopping the turn",
    (label) => {
      const openUrl = vi.fn(() => true);
      const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
        async () => {},
      );
      const cancel = vi.fn<PluginPendingInteractionProps["cancel"]>(
        async () => {},
      );
      const slot = renderPayload(urlPayload, { openUrl, submit, cancel });
      fireEvent.click(slot.getByRole("button", { name: label }));

      expect(submit).toHaveBeenCalledExactlyOnceWith({
        action: label.toLowerCase(),
      });
      expect(openUrl).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it.each([false, "throws"])(
    "does not accept when opening the URL returns %s",
    async (failure) => {
      const openUrl = vi.fn(() => {
        if (failure === "throws") throw new Error("Unavailable");
        return false;
      });
      const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
        async () => {},
      );
      const slot = renderPayload(urlPayload, { openUrl, submit });
      fireEvent.click(slot.getByRole("button", { name: "Open example.com" }));

      expect((await slot.findByRole("alert")).textContent).toContain(
        "Could not open this link",
      );
      expect(submit).not.toHaveBeenCalled();
      expect(
        slot.getByRole("button", { name: "Open example.com" }),
      ).toHaveProperty("disabled", false);
    },
  );

  it("retries response delivery without reopening an already-opened URL", async () => {
    const openUrl = vi.fn(() => true);
    const submit = vi
      .fn<PluginPendingInteractionProps["submit"]>()
      .mockRejectedValueOnce(new Error("Disconnected"))
      .mockResolvedValueOnce();
    const slot = renderPayload(urlPayload, { openUrl, submit });
    fireEvent.click(slot.getByRole("button", { name: "Open example.com" }));
    await slot.findByRole("alert");
    expect(
      slot.getByRole("link", { name: "Open link again" }).getAttribute("href"),
    ).toBe(urlPayload.url);
    fireEvent.click(slot.getByRole("button", { name: "Retry response" }));

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls).toEqual([
      [{ action: "accept" }],
      [{ action: "accept" }],
    ]);
    expect(slot.queryByRole("link", { name: "Open link again" })).toBeNull();
  });

  it("rejects a malformed URL payload without opening or accepting", () => {
    const openUrl = vi.fn(() => true);
    const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
      async () => {},
    );
    const slot = renderPayload(
      { ...urlPayload, url: "javascript:alert(1)" },
      { openUrl, submit },
    );

    expect(slot.getAllByRole("button")).toHaveLength(1);
    expect(slot.getByRole("button", { name: "Stop turn" })).toBeTruthy();
    expect(openUrl).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("unsupported Codex MCP requests", () => {
  it.each(["Decline", "Cancel"])(
    "explains unsupported schemas and permits %s without acceptance",
    (label) => {
      const submit = vi.fn<PluginPendingInteractionProps["submit"]>(
        async () => {},
      );
      const cancel = vi.fn<PluginPendingInteractionProps["cancel"]>(
        async () => {},
      );
      const slot = renderPayload(
        {
          kind: "unsupported",
          serverName: "example-service",
          message: "Provide account details",
          nativeMode: "form",
          reason: "Nested object fields are not supported.",
        },
        { submit, cancel },
      );

      expect(slot.getByText("example-service")).toBeTruthy();
      expect(
        slot.getByText("Nested object fields are not supported."),
      ).toBeTruthy();
      expect(slot.getAllByRole("button")).toHaveLength(2);
      fireEvent.click(slot.getByRole("button", { name: label }));
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        action: label.toLowerCase(),
      });
      expect(cancel).not.toHaveBeenCalled();
    },
  );
});
