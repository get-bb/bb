import { describe, expect, it } from "vitest";
import { resolveSubmitAffordance } from "./submit-mode";

const stop = () => undefined;

describe("resolveSubmitAffordance", () => {
  it("ready: send enabled only with input", () => {
    expect(
      resolveSubmitAffordance({
        mode: "ready",
        hasInput: true,
        isSubmitting: false,
        disabled: false,
        readyLabel: "Create",
      }),
    ).toMatchObject({
      kind: "send",
      icon: "ArrowUp",
      label: "Create",
      disabled: false,
      stop: null,
      longPressSteer: false,
    });
    expect(
      resolveSubmitAffordance({
        mode: { kind: "ready" },
        hasInput: false,
        isSubmitting: false,
        disabled: false,
      }),
    ).toMatchObject({ kind: "send", disabled: true });
  });

  it("queue: queue glyph, stop available, long-press steers", () => {
    expect(
      resolveSubmitAffordance({
        mode: { kind: "queue", onStop: stop },
        hasInput: true,
        isSubmitting: false,
        disabled: false,
      }),
    ).toMatchObject({
      kind: "queue",
      icon: "Plus",
      stop,
      longPressSteer: true,
      disabled: false,
    });
  });

  it("stop-only and blocked cannot submit; blocked explains why", () => {
    expect(
      resolveSubmitAffordance({
        mode: { kind: "stop-only", onStop: stop },
        hasInput: true,
        isSubmitting: false,
        disabled: false,
      }),
    ).toMatchObject({ kind: null, stop, disabled: true });
    expect(
      resolveSubmitAffordance({
        mode: { kind: "blocked", reason: "pending-interaction" },
        hasInput: true,
        isSubmitting: false,
        disabled: false,
      }),
    ).toMatchObject({
      kind: null,
      label: "Answer the pending request first",
      stop: null,
      disabled: true,
    });
  });

  it("submitting wins over everything and keeps the stop handle", () => {
    expect(
      resolveSubmitAffordance({
        mode: { kind: "queue", onStop: stop },
        hasInput: true,
        isSubmitting: true,
        disabled: false,
      }),
    ).toMatchObject({ kind: null, icon: "Spinner", stop, disabled: true });
  });
});
