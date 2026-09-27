// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentQuestionChoices } from "./AgentQuestionChoices.js";
import { detectAgentQuestions } from "./agent-questions.js";

vi.mock("./agent-questions.js", () => ({ detectAgentQuestions: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows parsed answer options without hover and adds a selected option to chat", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.mocked(detectAgentQuestions).mockResolvedValue([
    {
      prompt: "Merge now or wait?",
      kind: "either_or",
      propose: true,
      options: ["merge now", "wait for CI"],
      default: 1,
      multiSelect: false,
      span: [0, 18],
    },
  ]);
  const onAddToChat = vi.fn();
  render(
    <AgentQuestionChoices
      text="Merge now or wait?"
      onAddToChat={onAddToChat}
    />,
  );

  const option = await screen.findByRole("button", {
    name: "Add wait for CI to chat",
  });
  expect(screen.getByText("merge now")).toBeTruthy();
  expect(screen.getByText("Recommended")).toBeTruthy();
  fireEvent.click(option);
  expect(onAddToChat).toHaveBeenCalledWith("wait for CI");
});
