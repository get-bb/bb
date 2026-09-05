// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import {
  codexComputerUsePermissionSchema,
  type CodexComputerUsePermissionResponse,
} from "./mcp-elicitation.js";
import { decodeCodexInteractiveRequest } from "./interactive-requests.js";
import computerUseElicitation from "./fixtures/computer-use-elicitation.json";

const app = await loadPluginApp(() => import("../app.js"));
const registration = app.pendingInteractions.find(
  (interaction) => interaction.id === "mcp-elicitation",
);
if (!registration) throw new Error("Missing Codex MCP elicitation renderer");

afterEach(cleanup);

const decoded = decodeCodexInteractiveRequest(computerUseElicitation);
if (!decoded || !("data" in decoded.payload)) {
  throw new Error(
    "Computer Use fixture did not decode as an extension request",
  );
}
const permission = codexComputerUsePermissionSchema.parse(decoded.payload.data);

function renderPermission(
  overrides: Partial<PluginPendingInteractionProps> = {},
) {
  return renderSlot(registration!, {
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
  });
}

const responses: {
  label: string;
  response: CodexComputerUsePermissionResponse;
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
      "This app permission request could not be displayed.",
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
