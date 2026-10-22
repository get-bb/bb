import { describe, expect, it } from "vitest";
import { buildProviderPromptActionProps } from "../src/prompt/mentions/command-trigger.js";

describe("buildProviderPromptActionProps", () => {
  it("maps skills and insertion composer actions into prompt action props", () => {
    expect(
      buildProviderPromptActionProps([
        { kind: "skills", trigger: "/" },
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
        },
        {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
        },
      ]),
    ).toEqual({
      skillsTriggers: ["/"],
      promptActions: [
        { kind: "skills", text: "/" },
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
          text: "/plan ",
        },
        {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
          text: "/goal ",
        },
      ],
    });
  });
});
