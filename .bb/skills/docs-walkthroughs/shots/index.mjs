import { DEV_SERVER_URL, bb, privacyReplacements } from "../dev-cli.mjs";

const THREAD_COMPOSER = "#thread-detail-follow-up-composer";

const state = { parent: null, child: null };

function stage() {
  const threads = bb(["thread", "list"]);
  const archived = bb(["thread", "list", "--archived"]);
  const all = [...threads, ...archived];
  const parent = threads.find(
    (thread) =>
      !thread.parentThreadId && all.some((t) => t.parentThreadId === thread.id),
  );
  if (!parent) throw new Error("run the delegation walkthrough first");
  for (const child of archived.filter((t) => t.parentThreadId === parent.id)) {
    bb(["thread", "unarchive", child.id], { json: false });
  }
  const children = bb(["thread", "list", "--parent-thread", parent.id]);
  if (children.length === 0) throw new Error("the parent has no child threads");
  state.parent = parent;
  state.child = children[0];
}

export default {
  title: "What is bb",
  baseUrl: DEV_SERVER_URL,
  scheme: "light",
  replacements: privacyReplacements(),
  poster: { step: 2 },
  async setup(page) {
    stage();
    await page.goto("/", { text: state.parent.title });
  },
  shots: [
    {
      caption:
        "A thread is one conversation with one agent about one piece of work.",
      anchor: () => ({ text: state.parent.title }),
      async run(page) {
        await page.click({ text: state.parent.title });
        await page.waitFor(THREAD_COMPOSER);
      },
      after: THREAD_COMPOSER,
      hold: 2400,
    },
    {
      caption:
        "A child thread is started by another thread and reports back when it finishes.",
      anchor: () => ({ text: state.child.title }),
      run: (page) => page.hover({ text: state.child.title }),
      hold: 2800,
    },
    {
      caption: "A project is a repository bb works in.",
      anchor: { text: "acme-web", within: "main", closest: "button" },
      run: (page) =>
        page.hover({ text: "acme-web", within: "main", closest: "button" }),
      hold: 2400,
    },
    {
      caption: "By default each thread's code lives in its own Git worktree.",
      anchor: { text: "Worktree", within: "main", closest: "button" },
      run: (page) =>
        page.hover({ text: "Worktree", within: "main", closest: "button" }),
      hold: 2800,
    },
    {
      caption:
        "Agents are the coding agent CLIs that do the work. Settings calls them Providers.",
      anchor: { text: "Providers", within: "main" },
      before: (page) => page.goto("/settings/providers", { text: "Codex" }),
      hold: 3000,
    },
    {
      caption:
        "The server keeps your threads. Each machine runs agents for it.",
      anchor: { text: "Machines" },
      run: (page) => page.click({ text: "Machines" }),
      after: { text: "Studio", within: "main" },
      hold: 2800,
    },
    {
      caption:
        "Plugins add features to bb. Skills are instructions your agents load.",
      anchor: 'button[aria-label="Plugins"]',
      async run(page) {
        await page.click('button[aria-label="Plugins"]');
        await page.wait(1200);
      },
      hold: 2600,
    },
  ],
};
