import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { getMessageLinkPath, parseMessageLink } from "../src/index.js";

describe("message links", () => {
  it("round-trips project and projectless thread links", () => {
    for (const projectId of ["proj_abc", PERSONAL_PROJECT_ID]) {
      const path = getMessageLinkPath({
        projectId,
        threadId: "thr_abc",
        seq: 42,
      });
      expect(path).toBe(
        projectId === PERSONAL_PROJECT_ID
          ? "/threads/thr_abc#msg=42"
          : "/projects/proj_abc/threads/thr_abc#msg=42",
      );
      expect(parseMessageLink(path)).toEqual({ threadId: "thr_abc", seq: 42 });
      expect(parseMessageLink(`https://someone.getbb.app${path}`)).toEqual({
        threadId: "thr_abc",
        seq: 42,
      });
    }
  });

  it("rejects links that do not address one message of a thread", () => {
    for (const href of [
      "/projects/proj_abc/threads/thr_abc",
      "/projects/proj_abc/threads/thr_abc#msg=",
      "/projects/proj_abc/threads/thr_abc#msg=4a",
      "/projects/proj_abc/threads/thr_abc#msg=-1",
      "/projects/proj_abc/threads/thr_abc#msg=007",
      "/projects/proj_abc/threads/%E0%A4%A#msg=4",
      "/projects/proj_abc/archived#msg=4",
      "/projects/proj_abc/threads/thr_abc?msg=",
      "/projects/proj_abc/threads/thr_abc?msg=4a",
      "/projects/proj_abc/threads/thr_abc?msg=-1",
      "/projects/proj_abc/threads/thr_abc?msg=007",
      "/projects/proj_abc/threads/%E0%A4%A?msg=4",
      "/projects/proj_abc/archived?msg=4",
      "thr_abc",
    ]) {
      expect(parseMessageLink(href)).toBeNull();
    }
  });

  it("opens existing query links but lets the fragment select the message", () => {
    expect(parseMessageLink("/threads/thr_abc?msg=4")).toEqual({
      threadId: "thr_abc",
      seq: 4,
    });
    expect(parseMessageLink("/threads/thr_abc?msg=4#msg=42")).toEqual({
      threadId: "thr_abc",
      seq: 42,
    });
    expect(parseMessageLink("/threads/thr_abc?msg=4#msg=invalid")).toBeNull();
  });
});
