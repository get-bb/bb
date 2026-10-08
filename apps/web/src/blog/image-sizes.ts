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
  "/guides/remote-dev-servers/window-add-machine.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/remote-dev-servers/window-checkouts.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/orchestrate-coding-agents/window-start.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/orchestrate-coding-agents/window-manager.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/orchestrate-coding-agents/window-drag.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/orchestrate-coding-agents/window-automation.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/orchestrate-coding-agents/window-workflows.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/claude-code-and-codex-together/window-start.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/claude-code-and-codex-together/window-nested.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/claude-code-and-codex-together/window-split.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/claude-code-and-codex-together/window-talk.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/remote-dev-servers/window-new-thread.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/remote-dev-servers/window-terminal.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/remote-dev-servers/window-connect.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/work-from-anywhere/window-connect.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/work-from-anywhere/window-keep-awake.png": {
    width: 2048,
    height: 1280,
  },
  "/guides/work-from-anywhere/window-mobile.png": { width: 2048, height: 1280 },
  "/guides/work-from-anywhere/window-phone.png": { width: 780, height: 1688 },
};

export function getImageSize(src: string): ImageSize | undefined {
  return IMAGE_SIZES[src];
}
