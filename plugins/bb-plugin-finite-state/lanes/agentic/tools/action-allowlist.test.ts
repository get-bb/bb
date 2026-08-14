import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import plugin from "../../../server.js";
import {
  ACTION_TOOL_ALLOWLIST,
  assertActionBoundary,
} from "../../../lib/agentic/action-allowlist.js";
import {
  ACTION_TOOL_NAMES,
  AGENT_SURFACE,
} from "../../../lib/agentic/registry.js";
import type { AgentSurfaceCandidate } from "../../../lib/agentic/registry.js";
import type { AgentToolSpec } from "../../../lib/agentic/types.js";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function files(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("action allowlist guard", () => {
  it("equals the canonical closed eight-action registry set", () => {
    expect(ACTION_TOOL_ALLOWLIST).toEqual([
      "fs_verification_run",
      "fs_bench_run",
      "fs_firmware_materialize",
      "fs_hw_extract",
      "fs_build",
      "fs_flash",
      "fs_serial",
      "fs_probe",
    ]);
    expect(ACTION_TOOL_ALLOWLIST).toEqual(ACTION_TOOL_NAMES);
    expect(
      Object.values(AGENT_SURFACE.tools)
        .filter((tool) => tool.class === "action")
        .map((tool) => tool.name),
    ).toEqual(ACTION_TOOL_ALLOWLIST);
    expect(
      Object.values(AGENT_SURFACE.tools).filter(
        (tool) => "destructive" in tool && tool.destructive,
      ),
    ).toHaveLength(1);
    expect(() => assertActionBoundary(AGENT_SURFACE)).not.toThrow();
  });

  it("requires an amendment before a ninth action can be added", () => {
    const candidate: AgentSurfaceCandidate = {
      tools: {
        ...AGENT_SURFACE.tools,
        fs_other_action: {
          name: "fs_other_action",
          class: "action",
          server: "none",
          idempotency: "non-idempotent",
        },
      },
      directives: AGENT_SURFACE.directives,
    };
    expect(() => assertActionBoundary(candidate)).toThrow(
      /AMENDMENT_REQUIRED/iu,
    );
  });

  it("rejects a read-classified fs_sync_push hidden behind a __proto__ registry key", () => {
    const candidate: AgentSurfaceCandidate = {
      tools: {
        ...AGENT_SURFACE.tools,
        ["__proto__"]: {
          name: "fs_sync_push",
          class: "read",
          server: "none",
          idempotency: "idempotent",
        },
      },
      directives: AGENT_SURFACE.directives,
    };

    expect(() => assertActionBoundary(candidate)).toThrow(
      /PROHIBITED_AGENT_PUSH_TOOL/iu,
    );
  });

  it("rejects non-enumerable push identities by registry key or tool.name", () => {
    const pushByKey: Record<string, AgentToolSpec> = {
      ...AGENT_SURFACE.tools,
    };
    Object.defineProperty(pushByKey, "fs_sync_push", {
      value: {
        name: "fs_sync_push",
        class: "read",
        server: "none",
        idempotency: "idempotent",
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(() =>
      assertActionBoundary({
        tools: pushByKey,
        directives: AGENT_SURFACE.directives,
      }),
    ).toThrow(/PROHIBITED_AGENT_PUSH_TOOL/iu);

    const pushByName: Record<string, AgentToolSpec> = {
      ...AGENT_SURFACE.tools,
    };
    Object.defineProperty(pushByName, "hidden_push", {
      value: {
        name: "fs_sync_push",
        class: "read",
        server: "none",
        idempotency: "idempotent",
      },
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(() =>
      assertActionBoundary({
        tools: pushByName,
        directives: AGENT_SURFACE.directives,
      }),
    ).toThrow(/PROHIBITED_AGENT_PUSH_TOOL/iu);
  });

  it("rejects a prototype-inherited fs_sync_push registry key", () => {
    const prototype: Record<string, AgentToolSpec> = {
      fs_sync_push: {
        name: "fs_sync_push",
        class: "read",
        server: "none",
        idempotency: "idempotent",
      },
    };
    const tools: Record<string, AgentToolSpec> = Object.create(prototype);
    Object.assign(tools, AGENT_SURFACE.tools);

    expect(() =>
      assertActionBoundary({
        tools,
        directives: AGENT_SURFACE.directives,
      }),
    ).toThrow(/PROHIBITED_AGENT_PUSH_TOOL/iu);
  });

  it("rejects registry key and tool name identity splits", () => {
    const candidate: AgentSurfaceCandidate = {
      tools: {
        ...AGENT_SURFACE.tools,
        ["__proto__"]: {
          name: "fs_sync_status",
          class: "read",
          server: "none",
          idempotency: "idempotent",
        },
      },
      directives: AGENT_SURFACE.directives,
    };

    expect(() => assertActionBoundary(candidate)).toThrow(
      /AGENT_TOOL_REGISTRY_DRIFT/iu,
    );
  });

  it("checks the complete production registration set against the closed registry", async () => {
    const host = createFakePluginHost({
      pluginId: `fs-action-boundary-${crypto.randomUUID()}`,
    });
    await plugin(host.bb);
    const registered = host.harness.inspection.registrations.agentTools.map(
      (tool) => tool.name,
    );
    expect(() => assertActionBoundary(AGENT_SURFACE, registered)).not.toThrow();
    expect(() =>
      assertActionBoundary(AGENT_SURFACE, [...registered, "fs_rogue_action"]),
    ).toThrow(/REGISTRY_DRIFT/iu);
    expect(() =>
      assertActionBoundary(AGENT_SURFACE, [...registered, "fs_sync_push"]),
    ).toThrow(/PROHIBITED_AGENT_PUSH_TOOL/iu);
    for (const hostileName of [
      "__proto__",
      "constructor",
      "prototype",
      "toString",
      "FS_SYNC_PUSH",
      "fs_Sync_Push",
      "FS_BENCH_RUN",
      "fs_bench_run ",
      "fs_bench_run\u200b",
    ]) {
      expect(
        () => assertActionBoundary(AGENT_SURFACE, [...registered, hostileName]),
        hostileName,
      ).toThrow(/AGENT_TOOL_REGISTRY_DRIFT/iu);
    }
    await host.harness.lifecycle.dispose();
  });

  it("keeps non-action agent modules disconnected from remote action/write capability", () => {
    const agentic = join(pluginRoot, "lanes/agentic");
    const violations = files(agentic)
      .filter((path) => /\.(?:ts|tsx)$/u.test(path))
      .filter(
        (path) =>
          !path.endsWith("tools/actions.ts") &&
          !path.includes("action-allowlist.test"),
      )
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return /lib\/remote|RemoteServices|agentic\.action\.|sync\/push|raw.?api|generic.?request/iu.test(
          source,
        )
          ? [relative(pluginRoot, path)]
          : [];
      });
    expect(violations).toEqual([]);
  });

  it("never registers or advertises fs_sync_push while allowing prohibition prose", () => {
    const registrationFiles = files(pluginRoot).filter(
      (path) => /\.(?:ts|tsx)$/u.test(path) && !path.endsWith(".test.ts"),
    );
    const advertised = registrationFiles.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return /registerTool\s*\(\s*\{[\s\S]{0,1000}?name\s*:\s*["']fs_sync_push["']/su.test(
        source,
      )
        ? [relative(pluginRoot, path)]
        : [];
    });
    expect(advertised).toEqual([]);
    const skillsRoot = join(pluginRoot, "skills");
    const invalidSkillMentions = existsSync(skillsRoot)
      ? files(skillsRoot)
          .filter((path) => path.endsWith("SKILL.md"))
          .flatMap((path) => {
            const source = readFileSync(path, "utf8");
            if (!source.includes("fs_sync_push")) return [];
            const never =
              /^#{1,6}\s+Never\b[\s\S]*?(?=^#{1,6}\s|(?![\s\S]))/imu.exec(
                source,
              )?.[0] ?? "";
            return never.includes("fs_sync_push")
              ? []
              : [relative(pluginRoot, path)];
          })
      : [];
    expect(invalidSkillMentions).toEqual([]);
    expect(Object.keys(AGENT_SURFACE.tools)).not.toContain("fs_sync_push");
  });
});
