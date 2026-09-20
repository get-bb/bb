import type { Host } from "@bb/domain";
import {
  updateEnvironmentRequestSchema,
  updateHostRequestSchema,
  updateProjectRequestSchema,
  updateThreadRequestSchema,
  updateThreadSectionRequestSchema,
  type SidebarBootstrapResponse,
} from "@bb/server-contract";
import { makeThreadResponse } from "../src/test/fixtures/thread-responses";
import { makeEnvironment } from "./story-fixtures";

export function installSidebarRenameStoryApi({
  navigation: initialNavigation,
  hosts: initialHosts,
  failNextSave,
}: {
  navigation: SidebarBootstrapResponse;
  hosts: Host[];
  failNextSave: () => boolean;
}) {
  let navigation = structuredClone(initialNavigation);
  const hosts = structuredClone(initialHosts);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/v1/sidebar-bootstrap") {
      return Response.json(navigation);
    }
    if (request.method === "GET" && path === "/api/v1/hosts") {
      return Response.json(hosts);
    }
    const projects = [...navigation.projects, navigation.personalProject];
    const threads = projects.flatMap((project) => project.threads);
    const id = decodeURIComponent(path.split("/").at(-1) ?? "");
    const thread = threads.find((item) => item.id === id);
    const project = projects.find((item) => item.id === id);
    const host = hosts.find((item) => item.id === id);
    const environmentThread = threads.find((item) => item.environmentId === id);
    const isSection = path === "/api/v1/thread-sections";
    if (
      request.method !== "PATCH" ||
      !(thread || project || host || environmentThread || isSection)
    ) {
      return originalFetch(input, init);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    if (failNextSave()) {
      return Response.json(
        { error: "Could not save the name. Try again.", code: "unavailable" },
        { status: 503 },
      );
    }
    const body: unknown = await request.json();
    if (thread) {
      const { title } = updateThreadRequestSchema.parse(body);
      if (title !== undefined) thread.title = title;
      return Response.json(makeThreadResponse({ ...thread, runtime: {} }));
    }
    if (project) {
      const { name } = updateProjectRequestSchema.parse(body);
      if (name !== undefined) project.name = name;
      return Response.json(project);
    }
    if (host) {
      host.name = updateHostRequestSchema.parse(body).name;
      return Response.json(host);
    }
    if (environmentThread) {
      const { name } = updateEnvironmentRequestSchema.parse(body);
      for (const item of threads) {
        if (item.environmentId === id && name !== undefined)
          item.environmentName = name;
      }
      return Response.json(
        makeEnvironment({
          id,
          name: environmentThread.environmentName,
          projectId: environmentThread.projectId,
          branchName: environmentThread.environmentBranchName,
        }),
      );
    }
    const section = updateThreadSectionRequestSchema.parse(body);
    const name = section.name.trim();
    if (
      navigation.sections.some(
        (item) => item.id !== section.id && item.name === name,
      )
    ) {
      return Response.json(
        { error: "Section name already exists", code: "section_name_conflict" },
        { status: 409 },
      );
    }
    navigation = {
      ...navigation,
      sections: navigation.sections.map((item) =>
        item.id === section.id ? { ...item, name } : item,
      ),
    };
    return Response.json({ id: section.id, name, updatedThreadCount: 0 });
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}
