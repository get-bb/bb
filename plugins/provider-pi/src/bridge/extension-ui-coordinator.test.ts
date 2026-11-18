import { PLUGIN_INTERACTION_MAX_TITLE_LENGTH } from "@get-bb/plugin-sdk/provider-bridge";
import { expect, it } from "vitest";
import type {
  InteractionUiRequest,
  PiExtensionUiResponseFields,
} from "../extension-ui-contract.js";
import { PI_EXTENSION_UI_MAX_MESSAGE_LENGTH } from "../extension-ui-contract.js";
import { createExtensionUiCoordinator } from "./extension-ui.js";

function forward(title: string) {
  const sent: InteractionUiRequest[] = [];
  const responses: PiExtensionUiResponseFields[] = [];
  const coordinator = createExtensionUiCoordinator({
    sendInteractionRequest: (request) => sent.push(request),
  });
  coordinator.handle({
    scope: {},
    request: {
      id: "ui-1",
      method: "select",
      title,
      options: ["Allow", "Deny"],
    },
    threadId: "thr_ui",
    providerThreadId: "pi_ui",
    respond: (_id, fields) => responses.push(fields),
  });
  return { sent, responses };
}

it.each([160, 161, 200, 201, 4096])(
  "forwards a %i-character title within core's limit and keeps the full title for the card (#4264)",
  (length) => {
    const title = "x".repeat(length);
    const { sent, responses } = forward(title);

    expect(responses).toEqual([]);
    expect(sent).toHaveLength(1);
    const payload = sent[0]!.params.payload;
    expect(payload.title.length).toBeLessThanOrEqual(
      PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
    );
    if (length <= PLUGIN_INTERACTION_MAX_TITLE_LENGTH) {
      expect(payload.title).toBe(title);
      expect(payload.data.fullTitle).toBeUndefined();
    } else {
      expect(payload.title).toBe(`${"x".repeat(159)}…`);
      expect(payload.data.fullTitle).toBe(title);
    }
  },
);

it.each([8192, 8193, 32768])(
  "asks the user about a confirm with a %i-character message instead of declining it (#7647)",
  (length) => {
    const sent: InteractionUiRequest[] = [];
    const responses: PiExtensionUiResponseFields[] = [];
    const coordinator = createExtensionUiCoordinator({
      sendInteractionRequest: (request) => sent.push(request),
    });
    const message = "x".repeat(length);
    coordinator.handle({
      scope: {},
      request: {
        id: "ui-1",
        method: "confirm",
        title: "Bridge limit probe",
        message,
      },
      threadId: "thr_ui",
      providerThreadId: "pi_ui",
      respond: (_id, fields) => responses.push(fields),
    });

    expect(responses).toEqual([]);
    expect(sent).toHaveLength(1);
    const shown = sent[0]!.params.payload.data.message ?? "";
    expect(shown.length).toBeLessThanOrEqual(
      PI_EXTENSION_UI_MAX_MESSAGE_LENGTH,
    );
    if (length <= PI_EXTENSION_UI_MAX_MESSAGE_LENGTH) {
      expect(shown).toBe(message);
    } else {
      const visible = shown.indexOf("\n\n[");
      expect(shown).toMatch(/\[\d+ more characters not shown\]$/);
      expect(shown).toContain(
        `[${length - visible} more characters not shown]`,
      );
    }
  },
);
