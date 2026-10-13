import { PROVIDERS } from "./fixtures/providers.js";
import { DemoStateDO } from "./demo-state.js";

export interface Env {
  ASSETS: Fetcher;
  DEMO_STATE: DurableObjectNamespace;
}

export { DemoStateDO };

function demoStateName(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/u, "") || "/";
    const providerLogo = /^\/api\/v1\/system\/providers\/([^/]+)\/logo$/u.exec(
      path,
    );
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      providerLogo &&
      PROVIDERS.some((provider) => provider.id === providerLogo[1])
    ) {
      url.pathname = `/demo-providers/${providerLogo[1]}.svg`;
      url.search = "";
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (request.method === "GET" && path === "/api/v1/plugins") {
      url.pathname = "/demo-plugins/list.json";
      url.search = "";
      return env.ASSETS.fetch(new Request(url, request));
    }
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      path !== "/health" &&
      path !== "/ws" &&
      path !== "/api" &&
      !path.startsWith("/api/")
    ) {
      return env.ASSETS.fetch(request);
    }
    const id = env.DEMO_STATE.idFromName(demoStateName(request));
    return env.DEMO_STATE.get(id).fetch(request);
  },
};
