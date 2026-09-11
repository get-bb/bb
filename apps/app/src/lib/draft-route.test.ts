import { describe, expect, it } from "vitest";
import { getDraftRoutePath, parseDraftRouteId } from "./draft-route";
import { paneContentForPathname } from "@/views/thread-detail/splitThreadNavigation";

describe("draft routes", () => {
  it("round trips a stable draft alongside other query parameters", () => {
    const id = "drf_c4f849da-569e-4822-bb8d-b143438b20b7";
    expect(getDraftRoutePath(id)).toBe(`/?draft=${id}`);
    expect(parseDraftRouteId(`?draft=${id}&initialPrompt=hello`)).toBe(id);
    expect(paneContentForPathname(`/?draft=${id}#prompt`)).toEqual({
      kind: "new-thread",
      draftId: id,
    });
  });
  it.each(["", "?draft=", "?draft=thread_1", "?draft=drf_bad/path"])(
    "rejects invalid draft query %s",
    (search) => {
      expect(parseDraftRouteId(search)).toBeNull();
      expect(paneContentForPathname(`/${search}`)).toBeNull();
    },
  );
});
