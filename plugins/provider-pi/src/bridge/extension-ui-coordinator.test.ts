import {
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  type ThreadDelta,
} from "@get-bb/plugin-sdk/provider-bridge";
import { afterEach, expect, it, vi } from "vitest";
import type {
  InteractionUiRequest,
  PiExtensionUiResponseFields,
} from "../extension-ui-contract.js";
import { PI_EXTENSION_UI_MAX_MESSAGE_LENGTH } from "../extension-ui-contract.js";
import { createExtensionUiCoordinator } from "./extension-ui.js";

function forward(title: string, extra: { timeout?: number } = {}) {
  const sent: InteractionUiRequest[] = [];
  const responses: PiExtensionUiResponseFields[] = [];
  const cancelled: string[] = [];
  const scope = {};
  const coordinator = createExtensionUiCoordinator({
    sendInteractionRequest: (request) => sent.push(request),
    sendThreadDeltas: () => {},
    sendRequestCancelled: (requestId) => cancelled.push(requestId),
  });
  coordinator.handle({
    scope,
    request: {
      id: "ui-1",
      method: "select",
      title,
      options: ["Allow", "Deny"],
      ...extra,
    },
    threadId: "thr_ui",
    providerThreadId: "pi_ui",
    respond: (_id, fields) => responses.push(fields),
  });
  return { cancelled, coordinator, scope, sent, responses };
}

afterEach(() => {
  vi.useRealTimers();
});

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

it("withdraws the card when Pi's dialog timeout elapses", () => {
  vi.useFakeTimers();
  const { cancelled, coordinator, sent, responses } = forward("Continue?", {
    timeout: 5_000,
  });
  const interactionId = sent[0]!.id;

  vi.advanceTimersByTime(4_999);
  expect(cancelled).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(cancelled).toEqual([interactionId]);
  expect(responses).toEqual([]);
  expect(
    coordinator.handleRuntimeResponse({
      id: interactionId,
      result: { kind: "request_answer", value: "Allow" },
    }),
  ).toBe(false);
});

it("keeps an answered card from being withdrawn by its timeout", () => {
  vi.useFakeTimers();
  const { cancelled, coordinator, sent, responses } = forward("Continue?", {
    timeout: 5_000,
  });

  expect(
    coordinator.handleRuntimeResponse({
      id: sent[0]!.id,
      result: { kind: "request_answer", value: "Allow" },
    }),
  ).toBe(true);
  vi.advanceTimersByTime(10_000);
  expect(cancelled).toEqual([]);
  expect(responses).toEqual([{ value: "Allow" }]);
});

it("withdraws the card when the Pi session closes", () => {
  const { cancelled, coordinator, scope, sent, responses } =
    forward("Continue?");

  coordinator.cancelPendingForScope(scope);

  expect(cancelled).toEqual([sent[0]!.id]);
  expect(responses).toEqual([{ cancelled: true }]);
});

it.each([8192, 8193, 32768])(
  "asks the user about a confirm with a %i-character message instead of declining it (#7647)",
  (length) => {
    const sent: InteractionUiRequest[] = [];
    const responses: PiExtensionUiResponseFields[] = [];
    const deltas: ThreadDelta[] = [];
    const cancelled: string[] = [];
    const coordinator = createExtensionUiCoordinator({
      sendInteractionRequest: (request) => sent.push(request),
      sendThreadDeltas: (_threadId, threadDeltas) =>
        deltas.push(...threadDeltas),
      sendRequestCancelled: (requestId) => cancelled.push(requestId),
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
    expect(deltas).toEqual([]);
    expect(cancelled).toEqual([]);
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
