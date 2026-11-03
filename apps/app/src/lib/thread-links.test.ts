import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { parseThreadLink } from "./thread-links";

const origin = "https://bb.test";
const threadId = "thr_86mb5jjzi9";
const projectId = "proj_khiw2za95v";
const projectLink = `${origin}/projects/${projectId}/threads/${threadId}`;

describe("parseThreadLink", () => {
  it("names the link's project, or the personal project for a link without one", () => {
    expect(parseThreadLink(projectLink, origin)).toEqual({
      threadId,
      projectId,
    });
    expect(parseThreadLink(`${origin}/threads/${threadId}/`, origin)).toEqual({
      threadId,
      projectId: PERSONAL_PROJECT_ID,
    });
  });

  it.each([
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
  ])("is not a thread link of this bb: %s", (url) => {
    expect(parseThreadLink(url, origin)).toBeNull();
  });

  it("accepts the active HTTP development origin while keeping other ports literal", () => {
    const localOrigin = "http://localhost:3100";
    expect(
      parseThreadLink(`${localOrigin}/threads/${threadId}`, localOrigin),
    ).toEqual({ threadId, projectId: PERSONAL_PROJECT_ID });
    expect(
      parseThreadLink(`http://localhost:3101/threads/${threadId}`, localOrigin),
    ).toBeNull();
  });
});
