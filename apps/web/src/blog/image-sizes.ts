type ImageSize = { width: number; height: number };

const IMAGE_SIZES: Record<string, ImageSize> = {
  "/blog/building-a-restrained-software-factory/cover.jpg": {
    width: 1983,
    height: 793,
  },
  "/blog/building-a-restrained-software-factory/sub-thread.png": {
    width: 387,
    height: 120,
  },
  "/blog/building-a-restrained-software-factory/marketplace-manager.jpg": {
    width: 1200,
    height: 356,
  },
  "/blog/building-a-restrained-software-factory/workflow.jpg": {
    width: 1200,
    height: 691,
  },
  "/blog/an-agentic-ide-that-builds-itself/header.png": {
    width: 680,
    height: 272,
  },
  "/blog/an-agentic-ide-that-builds-itself/first-open.jpg": {
    width: 1360,
    height: 919,
  },
  "/blog/an-agentic-ide-that-builds-itself/custom.jpg": {
    width: 1660,
    height: 1127,
  },
  "/blog/an-agentic-ide-that-builds-itself/daw.jpg": {
    width: 1200,
    height: 900,
  },
  "/guides/claude-code-and-codex-together/subthread-sidebar.png": {
    width: 670,
    height: 216,
  },
  "/guides/claude-code-and-codex-together/split-view.png": {
    width: 2880,
    height: 1800,
  },
  "/guides/claude-code-and-codex-together/talk-it-through.png": {
    width: 2251,
    height: 820,
  },
  "/guides/work-from-anywhere/bb-connect-settings.png": {
    width: 1538,
    height: 890,
  },
  "/guides/orchestrate-coding-agents/new-thread.png": {
    width: 1280,
    height: 420,
  },
  "/guides/remote-dev-servers/new-thread-worktree.png": {
    width: 1280,
    height: 360,
  },
  "/guides/work-from-anywhere/keep-awake.png": { width: 1280, height: 840 },
  "/guides/run-an-agent-on-a-schedule/window-list.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/run-an-agent-on-a-schedule/window-compose.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/run-an-agent-on-a-schedule/window-detail.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/run-an-agent-on-a-schedule/window-script.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/run-an-agent-on-a-schedule/window-once.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/run-an-agent-on-a-schedule/window-notify.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/remote-dev-servers/add-a-machine.png": { width: 1024, height: 650 },
  "/guides/remote-dev-servers/new-project-machine.png": {
    width: 1024,
    height: 1014,
  },
  "/guides/remote-dev-servers/start-terminal.png": {
    width: 1120,
    height: 686,
  },
};

export function getImageSize(src: string): ImageSize | undefined {
  return IMAGE_SIZES[src];
}
