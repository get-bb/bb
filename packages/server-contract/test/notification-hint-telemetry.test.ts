import { describe, expect, it } from "vitest";
import { recordTelemetryEventRequestSchema } from "../src/index.js";

const properties = {
  surface: "hint",
  kind: "notifications",
  suggestion_analytics_id: "0b45b70a-4b01-40ae-9104-1ff7da129d97",
};

const events = [
  { name: "suggestion_shown", properties: { ...properties, trigger: "event" } },
  { name: "suggestion_accepted", properties },
  {
    name: "suggestion_dismissed",
    properties: { ...properties, dismiss: "not_now" },
  },
  {
    name: "suggestion_dismissed",
    properties: { ...properties, dismiss: "never" },
  },
];

describe("notification Hint telemetry privacy contract", () => {
  it.each(events)("accepts the closed $name properties", (event) => {
    expect(recordTelemetryEventRequestSchema.parse(event)).toEqual(event);
  });

  it.each(events)(
    "rejects free text and nonanalytics identifiers in $name",
    (event) => {
      for (const forbidden of [
        "title",
        "text",
        "threadId",
        "thread_analytics_id",
        "pluginId",
        "hint_copy",
      ]) {
        expect(
          recordTelemetryEventRequestSchema.safeParse({
            ...event,
            properties: { ...event.properties, [forbidden]: "private value" },
          }).success,
        ).toBe(false);
      }
      expect(
        recordTelemetryEventRequestSchema.safeParse({
          ...event,
          properties: {
            ...event.properties,
            suggestion_analytics_id: "thread-private-id",
          },
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unapproved kinds, surfaces, triggers, and dismissal values", () => {
    for (const extra of [
      { kind: "phone_pairing" },
      { surface: "next_step" },
      { trigger: "bb" },
      { trigger: "agent" },
    ]) {
      expect(
        recordTelemetryEventRequestSchema.safeParse({
          name: "suggestion_shown",
          properties: { ...properties, trigger: "event", ...extra },
        }).success,
      ).toBe(false);
    }
    expect(
      recordTelemetryEventRequestSchema.safeParse({
        name: "suggestion_dismissed",
        properties: { ...properties, dismiss: "this_thread" },
      }).success,
    ).toBe(false);
  });
});
