import { describe, expect, it } from "vitest";

import { dashboardSignInUrl } from "./worker";

describe("connect sign-in page", () => {
  it("points unauthenticated visitors at the dashboard auth flow with returnTo", () => {
    expect(
      dashboardSignInUrl(
        "https://getbb.app",
        "https://sawyer.getbb.app/thread/thr_123?view=full",
      ),
    ).toBe(
      "https://getbb.app/dashboard?returnTo=https%3A%2F%2Fsawyer.getbb.app%2Fthread%2Fthr_123%3Fview%3Dfull",
    );
  });

  it("uses the configured app origin for staging", () => {
    expect(
      dashboardSignInUrl(
        "https://vibecodethis.site",
        "https://sawyer.vibecodethis.site/",
      ),
    ).toBe(
      "https://vibecodethis.site/dashboard?returnTo=https%3A%2F%2Fsawyer.vibecodethis.site%2F",
    );
  });
});
