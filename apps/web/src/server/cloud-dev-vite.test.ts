import { describe, expect, it } from "vitest";
import { resolveCloudDevViteSettings } from "./cloud-dev-vite.js";

const localEnv = {
  BB_CLOUD_DEV_STATE_PATH: "/tmp/cloud-dev",
  BB_CLOUD_DEV_APP_URL: "http://bb.localhost:42745",
  BB_CLOUD_DEV_SERVER_URL_TEMPLATE: "http://{label}.bb.localhost:42745",
  BETTER_AUTH_SECRET: "shared-local-secret",
};

describe("resolveCloudDevViteSettings", () => {
  it("ignores local Cloud environment variables during builds", () => {
    expect(resolveCloudDevViteSettings("build", localEnv)).toBeNull();
  });

  it("configures local auth during the launcher-owned dev server", () => {
    expect(resolveCloudDevViteSettings("serve", localEnv)).toEqual({
      persistStatePath: "/tmp/cloud-dev",
      vars: {
        APP_URL: "http://bb.localhost:42745",
        BASE_DOMAIN: "bb.localhost",
        BETTER_AUTH_SECRET: "shared-local-secret",
        CONNECT_SERVER_URL_TEMPLATE: "http://{label}.bb.localhost:42745",
        DEV_EMAIL_PASSWORD_AUTH: "true",
        GITHUB_CLIENT_ID: "local-cloud-dev-unused",
        GITHUB_CLIENT_SECRET: "local-cloud-dev-unused",
      },
    });
  });
});
