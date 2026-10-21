import { describe, expect, it } from "vitest";
import { validWorkTelemetry } from "../../src/services/system/work-telemetry-schema.js";

describe("work telemetry vocabulary", () => {
  it.each(["user", "agent", "automation", "plugin", "system"])(
    "accepts the canonical %s initiator on existing events",
    (initiator) => {
      expect(
        validWorkTelemetry("thread_created", {
          is_child_thread: false,
          provider: "codex",
          initiator,
        }),
      ).toBe(true);
      expect(
        validWorkTelemetry("user_message_sent", {
          is_child_thread: false,
          provider: "codex",
          message_source: "thread_send",
          initiator,
        }),
      ).toBe(true);
    },
  );

  it("rejects private providers and retired initiators", () => {
    expect(
      validWorkTelemetry("thread_created", {
        is_child_thread: false,
        provider: "my-private-agent",
        initiator: "user",
      }),
    ).toBe(false);
    for (const initiator of ["person", "schedule", "unknown"]) {
      expect(
        validWorkTelemetry("user_message_sent", {
          is_child_thread: false,
          provider: "codex",
          message_source: "thread_create",
          initiator,
        }),
      ).toBe(false);
    }
  });

  it("accepts canonical finishes and rejects retired fields and values", () => {
    const properties = {
      thread_analytics_id: "a".repeat(32),
      parent_link: "root",
      request_link: "none",
      attempt_kind: "initial",
      initiator: "system",
      outcome: "succeeded",
      error_category: "none",
      provider: "codex",
      install_turn_number: 1,
    };
    expect(validWorkTelemetry("turn_finished", properties)).toBe(true);
    for (const extra of [
      { outcome: "completed" },
      { first_turn: true },
      { install_turn_number: 0 },
      { trigger: "person" },
    ]) {
      expect(
        validWorkTelemetry("turn_finished", { ...properties, ...extra }),
      ).toBe(false);
    }
  });
});
