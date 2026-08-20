import { describe, expect, it } from "vitest";
import { pluginInteraction } from "../test/fixtures";
import {
  buildSecretRequestResponse,
  parsePluginInteractionForm,
  SECRET_REQUEST_INVALID_VALUES_MESSAGE,
} from "./plugin-interaction-payloads";

describe("parsePluginInteractionForm", () => {
  it("parses ask-user-question payloads into form questions", () => {
    const form = parsePluginInteractionForm(
      pluginInteraction({
        id: "i1",
        rendererId: "ask-user-question",
        data: {
          questions: [
            {
              id: "q1",
              prompt: "Which?",
              shortLabel: "Which",
              multiSelect: false,
              allowFreeText: false,
              options: [{ value: "a", label: "A", preview: "P" }],
            },
          ],
        },
      }),
    );
    expect(form.kind).toBe("ask-user-question");
    if (form.kind !== "ask-user-question") throw new Error("unexpected");
    expect(form.questions[0]?.options[0]?.preview).toBe("P");
  });

  it("parses secret-request payloads and flags malformed ones", () => {
    const form = parsePluginInteractionForm(
      pluginInteraction({
        id: "i2",
        rendererId: "secret-request",
        pluginId: "secrets",
        data: {
          purpose: "Deploy",
          destination: { kind: "dotenv", path: "/repo/.env" },
          fields: [{ name: "API_KEY", description: null }],
        },
      }),
    );
    expect(form.kind).toBe("secret-request");
    expect(
      parsePluginInteractionForm(
        pluginInteraction({
          id: "i3",
          rendererId: "secret-request",
          data: { fields: [] },
        }),
      ),
    ).toEqual({ kind: "invalid", rendererId: "secret-request" });
  });

  it("reports unknown renderers as unsupported with their plugin id", () => {
    expect(
      parsePluginInteractionForm(
        pluginInteraction({
          id: "i4",
          rendererId: "fancy-form",
          pluginId: "my-plugin",
          data: {},
        }),
      ),
    ).toEqual({
      kind: "unsupported",
      pluginId: "my-plugin",
      rendererId: "fancy-form",
    });
  });
});

describe("buildSecretRequestResponse", () => {
  const payload = {
    purpose: null,
    destination: { kind: "dotenv" as const, path: "/repo/.env" },
    fields: [
      { name: "API_KEY", description: null },
      { name: "TOKEN", description: "t" },
    ],
  };

  it("sends exactly the requested names and drops strays", () => {
    const result = buildSecretRequestResponse(payload, {
      API_KEY: "k",
      TOKEN: "t",
      OTHER: "x",
    });
    expect(result).toEqual({
      ok: true,
      response: { values: { API_KEY: "k", TOKEN: "t" } },
    });
  });

  it("rejects missing or multi-line values", () => {
    expect(buildSecretRequestResponse(payload, { API_KEY: "k" })).toEqual({
      ok: false,
      message: SECRET_REQUEST_INVALID_VALUES_MESSAGE,
    });
    expect(
      buildSecretRequestResponse(payload, { API_KEY: "k", TOKEN: "a\nb" }).ok,
    ).toBe(false);
  });
});
