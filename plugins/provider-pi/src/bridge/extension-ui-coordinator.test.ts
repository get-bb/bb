import { PLUGIN_INTERACTION_MAX_TITLE_LENGTH } from "@get-bb/plugin-sdk/provider-bridge";
import { expect, it } from "vitest";
import type {
  InteractionUiRequest,
  PiExtensionUiResponseFields,
} from "../extension-ui-contract.js";
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
