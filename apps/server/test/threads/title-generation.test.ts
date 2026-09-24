import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import {
  collectInvokedPromptCommands,
  deriveTitleFallback,
  sanitizeGeneratedTitle,
  shouldGenerateThreadTitle,
} from "../../src/services/threads/title-generation.js";

function textInput(text: string): PromptInput {
  return {
    type: "text",
    text,
    mentions: [],
  };
}

function skillInput(name: string, rest = ""): PromptInput {
  const command = `/${name}`;
  return {
    type: "text",
    text: `${command}${rest}`,
    mentions: [
      {
        start: 0,
        end: command.length,
        resource: {
          kind: "command",
          trigger: "/",
          name,
          source: "skill",
          origin: "user",
          label: name,
          argumentHint: null,
        },
      },
    ],
  };
}

describe("thread title generation", () => {
  it("does not generate titles for inputs shorter than five words", () => {
    expect(shouldGenerateThreadTitle([textInput("fix")])).toBe(false);
    expect(shouldGenerateThreadTitle([textInput("fix bug")])).toBe(false);
    expect(shouldGenerateThreadTitle([textInput("fix the bug")])).toBe(false);
    expect(shouldGenerateThreadTitle([textInput("fix the login bug")])).toBe(
      false,
    );
  });

  it("generates titles for inputs with at least five words", () => {
    expect(
      shouldGenerateThreadTitle([textInput("fix the flaky login bug")]),
    ).toBe(true);
  });

  it("counts words across text input parts and ignores attachments", () => {
    const input: PromptInput[] = [
      textInput("fix the flaky"),
      {
        type: "localFile",
        path: "/tmp/error.log",
      },
      textInput("login bug"),
    ];

    expect(shouldGenerateThreadTitle(input)).toBe(true);
  });

  it("generates titles for scripts that do not separate words with spaces", () => {
    expect(
      shouldGenerateThreadTitle([
        textInput(
          "请帮我调查为什么侧边栏的线程行在分叉之后会显示错误的环境标记并且提出一个带有测试的修复方案",
        ),
      ]),
    ).toBe(true);
    expect(
      shouldGenerateThreadTitle([
        textInput(
          "サイドバーのスレッド行がフォーク後に誤った環境バッジを表示する理由を調査してください",
        ),
      ]),
    ).toBe(true);
  });

  it("still skips short unspaced inputs", () => {
    expect(shouldGenerateThreadTitle([textInput("修复这个错误")])).toBe(false);
    expect(shouldGenerateThreadTitle([textInput("バグを直して")])).toBe(false);
  });

  it("limits generated titles to five words", () => {
    expect(
      sanitizeGeneratedTitle(
        "Investigate Extremely Long Generated Thread Title Output",
      ),
    ).toBe("Investigate Extremely Long Generated Thread");
  });

  it("keeps generated titles that already fit", () => {
    expect(sanitizeGeneratedTitle("修复分叉后侧边栏徽章")).toBe(
      "修复分叉后侧边栏徽章",
    );
    expect(sanitizeGeneratedTitle("포크 후 사이드바 스레드 행의 배지 조사")).toBe(
      "포크 후 사이드바 스레드 행의 배지 조사",
    );
  });

  it("bounds unspaced generated titles instead of passing them through", () => {
    const title = sanitizeGeneratedTitle(
      "调查侧边栏线程行分叉后显示错误环境标记的问题并提出修复方案以及根本原因",
    );

    expect(title).not.toBeNull();
    expect(title?.length).toBeLessThanOrEqual(24);
    expect(
      "调查侧边栏线程行分叉后显示错误环境标记的问题并提出修复方案以及根本原因".startsWith(
        title ?? "",
      ),
    ).toBe(true);
  });

  it("falls back to a hard cut when the first word exceeds the budget", () => {
    expect(sanitizeGeneratedTitle("A".repeat(120))).toBe("A".repeat(48));
  });

  it("returns null for empty generated titles", () => {
    expect(sanitizeGeneratedTitle("   ")).toBeNull();
  });

  it("generates titles for invoked skills regardless of prompt length", () => {
    expect(shouldGenerateThreadTitle([skillInput("sync-repo")])).toBe(true);
    expect(
      shouldGenerateThreadTitle([skillInput("sync-repo", " then deploy")]),
    ).toBe(true);
  });

  it("keeps the raw command text as the fallback for invoked skills", () => {
    expect(deriveTitleFallback([skillInput("sync-repo", " then deploy")])).toBe(
      "/sync-repo then deploy",
    );
  });

  it("collects each invoked command once, in prompt order", () => {
    expect(
      collectInvokedPromptCommands([
        skillInput("sync-repo"),
        textInput("then"),
        skillInput("review-diff"),
        skillInput("sync-repo"),
      ]),
    ).toEqual([
      { name: "sync-repo", trigger: "/" },
      { name: "review-diff", trigger: "/" },
    ]);
  });

  it("keeps fallback derivation independent from title generation eligibility", () => {
    const input = [textInput("fix bug")];

    expect(deriveTitleFallback(input)).toBe("fix bug");
    expect(shouldGenerateThreadTitle(input)).toBe(false);
  });

  it("elides long latin fallbacks at eighty characters", () => {
    const input = [textInput("word ".repeat(40).trim())];

    expect(deriveTitleFallback(input)).toBe(`${"word ".repeat(40).trim().slice(0, 77)}...`);
  });

  it("elides wide-script fallbacks by display width, not code units", () => {
    const text = "调".repeat(60);
    const fallback = deriveTitleFallback([textInput(text)]);

    expect(fallback).toBe(`${"调".repeat(38)}...`);
  });

  it("never splits a surrogate pair when eliding a fallback", () => {
    const fallback = deriveTitleFallback([textInput("𠮷".repeat(60))]);

    expect(fallback).toBe(`${"𠮷".repeat(38)}...`);
    expect(fallback).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });
});
