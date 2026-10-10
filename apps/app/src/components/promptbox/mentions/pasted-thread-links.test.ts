import { describe, expect, it } from "vitest";
import { findPastedThreadLinks } from "./pasted-thread-links";

const origin = "https://bb.test";
const threadId = "thr_86mb5jjzi9";
const projectId = "proj_khiw2za95v";
const projectLink = `${origin}/projects/${projectId}/threads/${threadId}`;
const projectlessLink = `${origin}/threads/thr_dcwivn5n8w/`;

describe("findPastedThreadLinks", () => {
  it("keeps source offsets, punctuation, and repeated occurrences in mixed prose", () => {
    const text =
      `🧭 Use (**${projectLink}**), then ${projectlessLink}!\r\n` +
      `Keep https://example.com/threads/${threadId} and '${projectLink}'.`;
    const secondFrom = text.indexOf(projectlessLink);
    const repeatedFrom = text.lastIndexOf(projectLink);

    expect(findPastedThreadLinks({ text, origin })).toEqual([
      {
        from: 10,
        to: 10 + projectLink.length,
        text: projectLink,
        threadId,
        projectId,
      },
      {
        from: secondFrom,
        to: secondFrom + projectlessLink.length,
        text: projectlessLink,
        threadId: "thr_dcwivn5n8w",
        projectId: null,
      },
      {
        from: repeatedFrom,
        to: repeatedFrom + projectLink.length,
        text: projectLink,
        threadId,
        projectId,
      },
    ]);
  });

  it.each([
    ["inline code", `Keep \`${projectLink}\` literal.`],
    ["nested backticks", `\`\`code \` ${projectLink}\`\``],
    ["fenced code", `~~~text\n${projectLink}\n~~~`],
    ["unclosed fence", `\`\`\`text\n${projectLink}`],
    ["indented code", `    ${projectLink}`],
    ["blockquote", `> ${projectLink}`],
    ["lazy quote continuation", `> quoted\n${projectLink}`],
    ["Markdown link", `[${projectLink}](${projectlessLink})`],
    ["autolink", `<${projectLink}>`],
    [
      "reference link and definition",
      `[${projectLink}][context]\n\n[context]: ${projectlessLink}`,
    ],
    ["HTML anchor", `<a href="${projectLink}">Thread context</a>`],
  ])("preserves %s while recognizing adjacent prose", (_name, literal) => {
    const text = `${projectlessLink}\n\n${literal}`;

    expect(findPastedThreadLinks({ text, origin })).toEqual([
      {
        from: 0,
        to: projectlessLink.length,
        text: projectlessLink,
        threadId: "thr_dcwivn5n8w",
        projectId: null,
      },
    ]);
  });

  it("preserves foreign destinations and noncanonical thread routes", () => {
    const text = [
      `https://bb.test.example/threads/${threadId}`,
      `https://other.bb.test/threads/${threadId}`,
      `http://bb.test/threads/${threadId}`,
      `https://bb.test:444/threads/${threadId}`,
      `https://user:password@bb.test/threads/${threadId}`,
      `https://@bb.test/threads/${threadId}`,
      `ftp://bb.test/threads/${threadId}`,
      `/projects/${projectId}/threads/${threadId}`,
      `${projectLink}?view=detail`,
      `${projectLink}?`,
      `${projectLink}#message`,
      `${projectLink}#`,
      `${projectLink}/messages`,
      `${projectLink}//`,
      `${projectLink}x`,
      `${projectLink}_`,
      `${origin}/threads/thr_0123456789`,
      `${origin}/threads/thr_86mb5jjzi`,
      `${origin}/threads/%74hr_86mb5jjzi9`,
      `${origin}/projects/proj_0123456789/threads/${threadId}`,
      `${origin}/projects/../threads/${threadId}`,
      `${origin}/threads/./${threadId}`,
      `x${projectLink}`,
      `ftp:${projectLink}`,
    ].join("\n\n");

    expect(findPastedThreadLinks({ text, origin })).toEqual([]);
  });

  it("accepts the active HTTP development origin while keeping other ports literal", () => {
    const localOrigin = "http://localhost:3100";
    const localLink = `${localOrigin}/threads/${threadId}`;
    const text = `${localLink} http://localhost:3101/threads/${threadId}`;

    expect(findPastedThreadLinks({ text, origin: localOrigin })).toEqual([
      {
        from: 0,
        to: localLink.length,
        text: localLink,
        threadId,
        projectId: null,
      },
    ]);
  });
});
