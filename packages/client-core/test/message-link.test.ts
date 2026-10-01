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
      "/projects/proj_abc/threads/thr_abc?message=",
      "/projects/proj_abc/threads/thr_abc?message=4a",
      "/projects/proj_abc/threads/thr_abc?message=-1",
      "/projects/proj_abc/threads/thr_abc?message=007",
      "/projects/proj_abc/archived?message=4",
      "thr_abc",
    ]) {
      expect(parseMessageLink(href)).toBeNull();
    }
  });
});
