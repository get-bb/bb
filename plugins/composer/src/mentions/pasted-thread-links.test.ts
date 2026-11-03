import { describe, expect, it } from "vitest";
import type { ThreadLinkParser } from "./pasted-thread-link-candidates";
import { findPastedThreadLinks } from "./pasted-thread-links";

const origin = "https://bb.test";
const threadId = "thr_86mb5jjzi9";
const projectId = "proj_khiw2za95v";
const personalProjectId = "proj_personal";
const projectLink = `${origin}/projects/${projectId}/threads/${threadId}`;
const projectlessLink = `${origin}/threads/thr_dcwivn5n8w/`;
const links = new Map([
  [projectLink, { threadId, projectId }],
  [
    projectlessLink,
    { threadId: "thr_dcwivn5n8w", projectId: personalProjectId },
  ],
]);
const parseLink: ThreadLinkParser = (url) => links.get(url) ?? null;

describe("findPastedThreadLinks", () => {
  it("keeps source offsets, punctuation, and repeated occurrences in mixed prose", () => {
    const text =
      `🧭 Use (**${projectLink}**), then ${projectlessLink}!\r\n` +
      `Keep https://example.com/threads/${threadId} and '${projectLink}'.`;
    const secondFrom = text.indexOf(projectlessLink);
    const repeatedFrom = text.lastIndexOf(projectLink);

    expect(findPastedThreadLinks({ text, parseLink })).toEqual([
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
        projectId: personalProjectId,
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

    expect(findPastedThreadLinks({ text, parseLink })).toEqual([
      {
        from: 0,
        to: projectlessLink.length,
        text: projectlessLink,
        threadId: "thr_dcwivn5n8w",
        projectId: personalProjectId,
      },
    ]);
  });

  it("asks bb about whole URL tokens only", () => {
    const text = [
      `x${projectLink}`,
      `ftp:${projectLink}`,
      `${projectLink}x`,
      `${projectLink}?view=detail`,
    ].join("\n\n");

    expect(findPastedThreadLinks({ text, parseLink })).toEqual([]);
  });
});
