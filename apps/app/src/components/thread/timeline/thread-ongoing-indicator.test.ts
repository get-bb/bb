import { describe, expect, it } from "vitest";
import { resolveThreadOngoingIndicator } from "./thread-ongoing-indicator";

const idle = {
  activeBackgroundAgentCount: 0,
  activeBackgroundCommandCount: 0,
  activeWorkflowCount: 0,
  displayStatus: "idle",
  hostUnavailable: false,
  isStopping: false,
  isTurnSubmitting: false,
  timelineLoading: false,
} as const;

describe("resolveThreadOngoingIndicator", () => {
  it.each([
    {
      name: "a background-only indicator while runtime is idle with a workflow running",
      input: { ...idle, activeWorkflowCount: 1 },
      expected: { show: true, label: "Background work running" },
    },
    {
      name: "the normal working label while runtime is active",
      input: { ...idle, activeWorkflowCount: 1, displayStatus: "active" },
      expected: { show: true, label: undefined },
    },
    {
      name: "a background indicator for an idle thread with only a nested agent active",
      input: { ...idle, activeBackgroundAgentCount: 1 },
      expected: { show: true, label: "Background work running" },
    },
    {
      name: "no background indicator while the thread's machine is offline",
      input: {
        ...idle,
        activeBackgroundCommandCount: 1,
        hostUnavailable: true,
      },
      expected: { show: false, label: undefined },
    },
    {
      name: "no indicator once the nested agent count returns to zero",
      input: idle,
      expected: { show: false, label: undefined },
    },
  ] as const)("shows $name", ({ input, expected }) => {
    expect(resolveThreadOngoingIndicator(input)).toEqual(expected);
  });
});
