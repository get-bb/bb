import { expect, it } from "vitest";
import { splitMarkdownIntoChunks } from "./SkillDetailView";

it("never splits a chunk inside a code fence", () => {
  const fenced = [
    "intro",
    "",
    "```bash",
    ...Array.from({ length: 200 }, (_, i) =>
      i % 10 === 9 ? "" : `command ${i}`,
    ),
    "```",
    "",
    "outro",
  ].join("\n");
  const chunks = splitMarkdownIntoChunks(fenced);
  expect(chunks.length).toBeGreaterThan(1);
  for (const chunk of chunks) {
    const fenceCount = chunk
      .split("\n")
      .filter((line) => line.startsWith("```")).length;
    expect(fenceCount % 2).toBe(0);
  }
  expect(chunks.join("\n")).toBe(fenced);
});
