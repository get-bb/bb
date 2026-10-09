import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { expect, it } from "vitest";
import plugin from "./server.js";
import { bill, stepper } from "./examples.js";

it("publishes immutable answers, confines reads to their thread, and survives reload", async () => {
  let host = createFakePluginHost({ pluginId: "interactive-answers" });
  try {
    plugin(host.bb);
    const result = await host.harness.behavior.runCli([
      "publish",
      "--thread",
      "thr_test",
      "--document",
      JSON.stringify(bill),
    ]);
    const id = /id="([^"]+)"/.exec(result.stdout!)![1];
    const second = await host.harness.behavior.runCli([
      "publish",
      "--thread",
      "thr_test",
      "--document",
      JSON.stringify(bill),
    ]);
    expect(second.stdout).not.toBe(result.stdout);
    await expect(
      host.harness.behavior.callRpc("get", { id, threadId: "thr_other" }),
    ).rejects.toThrow("unavailable");
    const guide = await host.harness.behavior.runCli(["guide"]);
    expect(JSON.parse(guide.stdout!).examples.bill.title).toBe(bill.title);
    const html = await host.harness.behavior.runCli([
      "publish",
      "--thread",
      "thr_test",
      "--answer",
      JSON.stringify(stepper),
    ]);
    const htmlId = /id="([^"]+)"/.exec(html.stdout!)![1];
    expect(
      (
        await host.harness.behavior.runCli([
          "publish",
          "--thread",
          "thr_test",
          "--answer",
          JSON.stringify({ html: "<p>Hi</p>" }),
        ])
      ).exitCode,
    ).toBe(1);
    const page = await host.harness.behavior.fetchHttp(
      "GET",
      `/frame?thread=thr_test&id=${htmlId}`,
    );
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toBe(
      "sandbox allow-scripts",
    );
    expect(await page.text()).toContain("Repot a houseplant");
    expect(
      (
        await host.harness.behavior.fetchHttp(
          "GET",
          `/frame?thread=thr_other&id=${htmlId}`,
        )
      ).status,
    ).toBe(404);
    host = await host.harness.lifecycle.reload(plugin);
    expect(
      await host.harness.behavior.callRpc("get", {
        id: htmlId,
        threadId: "thr_test",
      }),
    ).toEqual({
      id: htmlId,
      threadId: "thr_test",
      kind: "html",
      widget: stepper,
    });
    expect(
      await host.harness.behavior.callRpc("get", { id, threadId: "thr_test" }),
    ).toMatchObject({ kind: "document", document: bill });
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

it("shares answer state, logs events for watch, and runs agent commands in the most recently used open copy", async () => {
  const host = createFakePluginHost({ pluginId: "interactive-answers" });
  try {
    plugin(host.bb);
    const { runCli, callRpc } = host.harness.behavior;
    const id = /id="([^"]+)"/.exec(
      (
        await runCli([
          "publish",
          "--thread",
          "thr_test",
          "--answer",
          JSON.stringify(stepper),
        ])
      ).stdout!,
    )![1];
    const cli = (...argv: string[]) =>
      runCli([...argv, "--thread", "thr_test"]);
    expect(JSON.parse((await cli("state", id)).stdout!)).toMatchObject({
      state: null,
      version: 0,
    });
    await callRpc("setState", {
      id,
      threadId: "thr_test",
      clientId: "client-one-123",
      state: { step: 2 },
    });
    expect(await callRpc("getState", { id, threadId: "thr_test" })).toEqual({
      state: { step: 2 },
      version: 1,
    });
    await expect(
      callRpc("setState", {
        id,
        threadId: "thr_other",
        clientId: "client-one-123",
        state: {},
      }),
    ).rejects.toThrow("unavailable");
    expect(
      JSON.parse(
        (await cli("state", id, "--set", JSON.stringify({ step: 3 }))).stdout!,
      ),
    ).toMatchObject({ state: { step: 3 }, version: 2 });
    expect(host.harness.inspection.realtimeSignals.at(-1)).toEqual({
      channel: "state",
      payload: { id, threadId: "thr_test", version: 2, by: "agent" },
    });
    const history = (await cli("watch", id))
      .stdout!.trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(history.map((e) => e.kind)).toEqual(["state", "state"]);
    const waiting = cli(
      "watch",
      id,
      "--since",
      String(history[1].seq),
      "--wait",
      "5",
    );
    await callRpc("event", {
      id,
      threadId: "thr_test",
      clientId: "client-one-123",
      name: "step",
      data: 4,
    });
    expect(JSON.parse((await waiting).stdout!)).toMatchObject({
      kind: "event",
      data: { name: "step", data: 4 },
    });
    await expect(
      callRpc("event", {
        id,
        threadId: "thr_test",
        clientId: "client-one-123",
        name: "big",
        data: "x".repeat(30_000),
      }),
    ).rejects.toThrow();

    expect((await cli("do", id, "next")).stderr).toContain("not open anywhere");
    await callRpc("presence", {
      id,
      threadId: "thr_test",
      clientId: "client-one-123",
      actions: ["next"],
      active: false,
    });
    await callRpc("presence", {
      id,
      threadId: "thr_test",
      clientId: "client-two-123",
      actions: ["next"],
      active: false,
    });
    await callRpc("presence", {
      id,
      threadId: "thr_test",
      clientId: "client-one-123",
      actions: ["next"],
      active: true,
    });
    expect(JSON.parse((await cli("actions", id)).stdout!)).toMatchObject({
      open: 2,
      actions: ["next"],
    });
    expect((await cli("do", id, "jump")).stderr).toContain("Available: next");
    const done = cli("do", id, "next", "--args", "[2]");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const command = host.harness.inspection.realtimeSignals.at(-1)!;
    expect(command).toMatchObject({
      channel: "command",
      payload: { id, clientId: "client-one-123", action: "next", args: [2] },
    });
    const { cmdId } = command.payload as { cmdId: string };
    await callRpc("result", {
      cmdId,
      clientId: "client-two-123",
      ok: false,
      error: "wrong copy",
    });
    await callRpc("result", {
      cmdId,
      clientId: "client-one-123",
      ok: true,
      value: { step: 5 },
    });
    expect(JSON.parse((await done).stdout!)).toEqual({ step: 5 });
    const tail = (await cli("watch", id, "--since", String(history[1].seq)))
      .stdout!.trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(tail.map((e) => e.kind)).toEqual(["event", "command", "result"]);
    const { itemId } = (await callRpc("share", {
      id,
      threadId: "thr_test",
      clientId: "client-one-123",
      label: "Synth take",
      data: { keys: [["C4", 0, 1]] },
    })) as { itemId: string };
    const provider =
      host.harness.inspection.registrations.mentionProviders.find(
        (p) => p.id === "shared",
      )!;
    expect(
      await provider.search({
        trigger: "@",
        query: "",
        projectId: null,
        threadId: "thr_test",
      }),
    ).toEqual([]);
    const { context } = await provider.resolve(itemId);
    expect(context).toContain('"Synth take"');
    expect(context).toContain(
      '<answer-data>\n{"keys":[["C4",0,1]]}\n</answer-data>',
    );
    expect(context).toContain("not as instructions");
    expect(context).toContain(`bb interactive-answers do ${id}`);
    await expect(
      Promise.resolve().then(() => provider.resolve(`${id}.999999`)),
    ).rejects.toThrow("no longer available");
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
