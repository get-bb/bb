# Render invariants

`tests/render-invariants` (`@bb/render-invariants`) drives the compiled web app
in headless Chromium and checks which React components render when something
happens. It asserts invariants, never budgets: each test names a set of renders
that must be empty, such as "sidebar rows other than X's" after a push for
thread X. A legitimate change does not move an invariant; it only fails when
work happens that should not happen at all.

## What runs

- **App build.** `@bb/app#build:profiling` builds `apps/app` with the normal
  Vite configuration, including the React Compiler, into
  `apps/app/dist-profiling`. It aliases `react-dom/client` to
  `react-dom/profiling` and skips minification so failures name components.
  Plugin frontends are built by the server at install, as in production.
- **Fixture.** `src/fixture.ts` boots the integration harness: the real server
  and host daemon in process, a fresh temporary data directory, and the
  scripted echo provider (no real providers, no network). It serves the
  profiling build, installs the Thread list, Navigation, Composer, Drafts and
  Git plugins, and seeds through the public API: 500 sidebar threads in one
  project, a 40-turn timeline (markdown, code fences, tables, tool calls), a
  thread with a pending Ask User Question, and a "Push target" thread with the
  newest activity. Seeding takes about 20 seconds.
- **Probe.** `src/render-probe.js` is injected before the app loads. It
  installs a React DevTools global hook and, on every commit, records each
  function, class, `forwardRef` or `memo` component that rendered, whether it
  mounted, and the DOM region its top-level host nodes belong to:
  - a sidebar row: the largest ancestor that contains exactly one
    `a[data-sidebar-thread-id]`;
  - a timeline row: the nearest `[data-timeline-row-id]`;
  - an arbitrary container, checked when the test asks for a report.

  A component is attributed to a region only when all of its top-level host
  nodes are in it, so list-level wrappers are not mistaken for a row.
  Components that render no DOM use their nearest host ancestor.

- **Settling.** A page counts as loaded once no commit has happened for 3
  seconds. That outlasts the startup probe of the local host daemon helper,
  which the in-process fixture does not serve (like a browser reaching bb over
  Connect) and which retries twice at 1-second intervals. After an action, the
  test waits for 1 second without commits. A page that never settles fails with
  the list of components that kept rendering.

## Invariants

| Test                                                                         | Region that must stay quiet                                            | CI  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --- |
| renders nothing while the app sits idle for 10 s                             | every component, mounts included                                       | on  |
| typing an Ask User Question answer renders nothing outside the question form | everything outside `[data-question-form]` (keystrokes after the first) | on  |
| typing in the composer renders nothing outside the composer box              | everything outside `[data-composer-box]` (keystrokes after the first)  | on  |
| renaming thread X re-renders no sidebar row but X's                          | sidebar rows of other threads                                          | on  |
| a turn in thread X re-renders no sidebar row but X's                         | sidebar rows of other threads                                          | on  |
| a streaming push re-renders no finished timeline row                         | timeline rows other than the streaming one                             | on  |

Re-render invariants ignore mounts: windowed lists mount rows as they scroll,
and a mounted child is always accompanied by its re-rendered parent. Typing
invariants skip the first keystroke, which legitimately toggles controls such
as the send button.

Pending invariants describe behavior main does not meet yet. Declare one with
`it.skipIf(process.env.BB_RENDER_INVARIANTS_PENDING !== "1")`, mark it
"pending" in the table above and record why main fails it here; it runs only
when `BB_RENDER_INVARIANTS_PENDING=1`. None are pending now. A change that
fixes a pending invariant turns its test on by declaring it with `it` and
removing its "pending" mark.

## Running locally

Install the pinned headless Chromium once:

```sh
pnpm --filter @bb/render-invariants exec playwright-core install --only-shell chromium
```

Run the suite. Turbo builds `@bb/app#build:profiling` first:

```sh
pnpm exec turbo run test:render-invariants --filter=@bb/render-invariants
```

Include the pending invariants:

```sh
BB_RENDER_INVARIANTS_PENDING=1 pnpm exec turbo run test:render-invariants --filter=@bb/render-invariants
```

Run one test against an existing profiling build:

```sh
cd tests/render-invariants
BB_RENDER_INVARIANTS_PENDING=1 pnpm exec vitest run --config vitest.render-invariants.config.ts -t "streaming"
```

From inside a bb thread, unset the thread's `BB_*` variables first (for
example `env -u BB_SERVER_URL -u BB_DATA_DIR -u BB_THREAD_ID ...`) so the
fixture does not inherit the parent instance's settings.

To explore the fixture by hand, start it and open the printed URLs in a
browser:

```sh
pnpm exec turbo run serve --filter=@bb/render-invariants
```

It listens on port 41997 (`BB_RENDER_INVARIANTS_PORT` overrides it) and prints
the timeline, question and sidebar thread URLs. The React DevTools Profiler
works against this build.

## Writing an invariant

1. Pick an interaction and the region that must not render because of it.
   Name the region by a DOM marker the product already renders
   (`data-sidebar-thread-id`, `data-timeline-row-id`, a form) rather than by
   component names, which change with refactors and are minified in plugins.
2. Open a page with `openThread`, perform the step that may legitimately
   render (the first keystroke, the start of a stream), `settle()`, then
   `reset()`.
3. Perform the measured step and `settle()` or wait for a DOM condition that
   proves it took effect.
4. Read `report({ container })` and filter `rerendered(report)` (or all
   renders, for idle) to the forbidden region. Assert
   `expect(summarize(violations)).toEqual([])`; the failure lists
   `<count>x <Component> in <region>`.
5. Assert that the step reached the UI, for example that the target row
   rendered or the input holds the typed text, so a broken selector cannot
   pass silently.
6. Prove it fails on the bug it guards: revert the past fix or inject the
   regression, run `pnpm exec turbo run build:profiling --filter=@bb/app`,
   and run the test. Then restore the source and run the suite several times
   to show it passes reliably.

Do not assert commit counts, render counts or durations. If main violates
the invariant, add it as a pending invariant and record the cause above.

## CI

The `Render invariants` job runs on main pushes, manual runs and pull requests
that change `apps/app`, `packages/client-core`, `packages/core-ui`,
`packages/plugin-sdk`, `packages/shared-ui`, `packages/thread-view`, a plugin
whose `package.json` declares `bb.app`, the suite itself, the scripted echo
provider, or the integration harness helpers. Selection lives in
`scripts/plan-ci.mjs`. The job installs the Chromium headless shell pinned by
`playwright-core` and runs the Turbo task above.

Idle, typing, and push invariants live in separate files. Vitest runs those
files concurrently with at most three workers on the existing four-vCPU
runner. Each file owns its server, database, provider, browser, and cleanup.
Within each file, scenarios remain sequential with fresh browser contexts and
the original settling and observation windows. The job count and runner size
are unchanged. Fixture setup repeats across the three groups, but browser
waits overlap and dependency installation and the profiling build run once.
