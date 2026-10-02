# Host UI, status, and lifecycle

### bb.ui — host-rendered UI (no frontend bundle needed)

```ts
bb.ui.registerMentionProvider({
  id: "issue",
  label: "Issues",
  triggers: ["@", "#"], // optional; defaults to ["@"]. Valid: @ # $ ! ~
  search({ trigger, query, projectId, threadId }) {
    // 2s time box, failure = empty list
    return [{ id: "42", title: "ENG-42 Fix flake", subtitle: "Todo" }];
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
`experimental_images` may add bounded agent-only `image` URL or `localImage`
path inputs, each with optional `context`. Treat remote and page-derived image
content as untrusted evidence. Invalid images block the send rather than being
silently dropped.
All handlers run server-side. Frontend thread-header actions use
`app.slots.threadHeader`.
There is deliberately no plugin slash-command surface: the composer's `/`
menu lists skills, so a plugin capability that crafts a prompt for the agent
ships as a `skills/` entry instead.

### bb.status

`bb.status.needsConfiguration(message)` — mark the plugin
`needs-configuration` (shown in `bb plugin list` and the UI) instead of
failing. Cleared on the next load.

### bb.onInstall

`bb.onInstall(handler)` runs once, right after the user installs
the plugin and its server entry has loaded. It does not run on update,
reload, enable, or server restart, and not for bb's bundled plugins;
reinstalling after removal runs it again. Use it for one-time setup the user
would expect from installing, such as picking the plugin's sidebar slots:

```ts
bb.onInstall(async () => {
  const { preferences } = await bb.sdk.system.uiPreferences.list();
  for (const key of ["sidebar.navigationProvider", "sidebar.headerProvider"] as const) {
    await bb.sdk.system.uiPreferences.set({
      key,
      value: "my-plugin/icons",
      expectedRevision: preferences[key].revision,
    });
  }
});
```

A handler that throws is logged and the install still succeeds; the install
waits at most 30 seconds for handlers. In tests,
`harness.lifecycle.install()` runs them.

### bb.onDispose and the reload lifecycle

`bb.onDispose(hook)` registers cleanup; hooks run **LIFO**. On
reload the host first runs the factory against a candidate registration set.
If it throws, the complete previous set stays live. Once the candidate
succeeds, the host disposes the old host artifact first. It then interrupts
pending plugin input, aborts services, and waits up to five seconds for each
service. A hung service marks the plugin as degraded until it stops. The host
then runs dispose hooks in LIFO order. One failed hook does not stop later
cleanup. It gives in-flight HTTP, RPC, and event handlers five seconds to
finish. It then closes database handles and invalidates the old `bb` object.
Disable and shutdown use the same sequence without a replacement. A
captured `bb` from a previous load throws `PluginContextStaleError` on use
— never stash the API object in module-level state that outlives a load.
