# Host UI, status, and lifecycle

### bb.ui — host-rendered UI (no frontend bundle needed)

```ts
bb.ui.registerMentionProvider({
  id: "issue",
  label: "Issues",
  triggers: ["@", "#"], // optional; defaults to ["@"]. Valid: @ # $ ! ~
  async search({ trigger, query, projectId, threadId, experimental_signal }) {
    // 2s time box, failure = empty list
    const response = await fetch(issueSearchUrl(query), {
      signal: experimental_signal, // typed past, timed out, or unloaded
    });
    const issues: Array<{ key: string; title: string; state: string }> =
      await response.json();
    return issues.map((issue) => ({
      id: issue.key,
      title: `${issue.key} ${issue.title}`,
      subtitle: issue.state,
    }));
  },
  resolve(itemId) {
    // once per unique item AT SEND TIME
    return {
      context: "# ENG-42…",
      experimental_images: [
        {
          type: "localImage",
          path: "/absolute/path/capture.jpg",
          context: "Selected element",
        },
      ],
    }; // attached as agent-only context; throwing BLOCKS the send
  },
});
```

Mention items render under `label` in the menu for each registered trigger.
A provider runs one search at a time. A query typed while a search is running
waits, and only the newest waiting query runs. A search still running after
its 2s time box keeps the provider out of results until it settles.
`experimental_signal` aborts when the person types past the query, the time
box runs out, or the plugin unloads; pass it to `fetch` or check it between
steps so the next query starts sooner.
`experimental_images` may add bounded agent-only `image` URL or `localImage`
path inputs, each with optional `context`. Treat remote and page-derived image
content as untrusted evidence. Invalid images block the send rather than being
silently dropped.
All handlers run server-side. There is deliberately no plugin slash-command surface: the composer's `/`
menu lists skills, so a plugin capability that crafts a prompt for the agent
ships as a `skills/` entry instead.

### bb.status

`bb.status.needsConfiguration(message)` — mark the plugin
`needs-configuration` instead of failing. `bb plugin list` shows the message;
the plugin's page shows it only when the plugin has no settings, and links to
its settings otherwise. Cleared on the next load; saving a changed setting
retries the load.

### bb.onInstall

`bb.onInstall(handler)` runs once, right after the user installs
the plugin and its server entry has loaded. It does not run on update,
reload, enable, or server restart, and not for bb's bundled plugins;
reinstalling after removal runs it again. Use it for one-time setup the user
would expect from installing, such as picking the plugin's thread list. Leave
a pick the user already made alone (see frontend-registration.md, Exclusive
slots):

```ts
bb.onInstall(async () => {
  const { preferences } = await bb.sdk.system.uiPreferences.list();
  const current = preferences["sidebar.threadListProvider"];
  if (current === undefined || current.value !== "__automatic__") return;
  await bb.sdk.system.uiPreferences.set({
    key: "sidebar.threadListProvider",
    value: "my-plugin/inbox",
    expectedRevision: current.revision,
  });
});
```

A handler that throws is logged and the install still succeeds; the install
waits at most 30 seconds for handlers. In tests,
`harness.lifecycle.install()` runs them.

### bb.onDispose and the reload lifecycle

`bb.onDispose(hook)` registers cleanup; hooks run **LIFO**. On reload the
host first runs the factory against a candidate registration set; if it
throws, the complete previous set stays live. Whenever a load fails after its
factory ran (the factory throws, the host entry fails to build, or the old
generation's services are still hung after teardown), the candidate's own
dispose hooks run in LIFO order before its `bb` is invalidated, on a first load
as well as a reload. Once the candidate succeeds, the
old generation is torn down in order: its WebSockets close with code 1012, the
CLI `ctx.signal` and RPC `experimental_signal` of its in-flight calls abort,
its host workers stop, input it requested is interrupted (forms the new
generation raised while loading stay pending), services are aborted and get up
to five seconds each (a hung service marks the plugin degraded until it
stops), WebSocket `onClose` handlers run, dispose hooks run in LIFO order (one
failed hook does not stop later cleanup), and in-flight HTTP, RPC, CLI and
event handlers get five seconds to finish. Callers still waiting after that
get an error saying the plugin was reloaded or disabled; the handler itself
keeps running until it stops on its signal. Then database handles close and
the old `bb` object is invalidated. Requests that arrive during this teardown
are still served by the old generation. Disable, removal and shutdown use the
same sequence without a replacement, and also interrupt every pending input
the plugin owns. A captured `bb` from a previous load throws
`PluginContextStaleError` on use — never stash the API object in
module-level state that outlives a load. bb logs that error, and any other
uncaught exception thrown from plugin code, against the plugin and keeps
running.
