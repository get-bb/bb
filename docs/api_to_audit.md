# APIs To Audit

## `PluginContentScriptContext.experimental_setThreadRowStatus`

Lets a plugin-lifetime content script set or clear one of its own status
indicators on an explicit thread row. The status survives route changes and is
cleared automatically when that frontend generation deactivates.

Before stabilization, audit:

- whether explicit thread targeting belongs on content-script context or a
  dedicated app-level controller;
- multiple simultaneous runs owned by one plugin on one thread;
- arbitration with composer-owned and native thread statuses;
- persistence expectations across full app reloads and multiple windows;
- validation, accessibility labels, reduced motion, and cleanup on plugin
  reload/disable/removal.
