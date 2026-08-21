import type { MarketplaceManifest } from "./marketplace-manifest.js";
import { CURATED_MARKETPLACE_NAME } from "./marketplace-manifest.js";

/**
 * Seed snapshot of the official marketplace, bundled with the app. It is the
 * first-run catalog and the offline fallback when a refresh has never
 * succeeded. Entry ids are plugin ids: an install aborts when the fetched
 * manifest declares another id.
 *
 * github.com/brsbl/bb-plugins is the source of truth for these plugins; the
 * published manifest replaces this snapshot on the first successful refresh.
 */
export const BUNDLED_CURATED_MARKETPLACE: MarketplaceManifest = {
  schemaVersion: 1,
  name: CURATED_MARKETPLACE_NAME,
  displayName: "BB Community",
  description: "Plugins published to the BB registry and reviewed by the BB team.",
  plugins: [
    {
      id: "thread-hover-cards",
      displayName: "Thread Hover Cards",
      description:
        "Preview thread status, the latest agent update, and repository or PR context from the sidebar.",
      icon: "ZoomIn",
      tags: ["interface", "threads", "sidebar"],
      author: { name: "Bersabel Tadesse", github: "brsbl" },
      source: {
        git: {
          url: "https://github.com/brsbl/bb-plugins.git",
          // Pinned to a reviewed commit of bb-plugins plugin/thread-hover-cards.
          ref: "30f91fd977ba1ce60532af27a68534464fb62516",
        },
      },
    },
    {
      id: "prompt-shaper",
      displayName: "Prompt Improver",
      description:
        "Adds an Improve prompt action to the composer that sends your rough draft to a hidden helper agent, which applies the prompt-shaper skill to rewrite it into a clear, complete prompt and returns it in place for review before you send.",
      icon: "AiContentGenerator01",
      tags: ["agent-interaction", "prompts"],
      author: { name: "Bersabel Tadesse", github: "brsbl" },
      source: {
        git: {
          url: "https://github.com/brsbl/bb-plugins.git",
          // Pinned to a reviewed commit of bb-plugins plugin/improve-prompt.
          ref: "1c6bb2e8ad3551466981e7eb027cc4b1f3428cac",
        },
      },
    },
  ],
};
