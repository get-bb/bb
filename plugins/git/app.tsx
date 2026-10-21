import { definePluginApp } from "@get-bb/plugin-sdk/app";
import {
  ComposerGitSegment,
  useComposerGitVisible,
} from "./ComposerSegment.js";
import { DiffPanel, useDiffVisible } from "./DiffPanel.js";
import { gitDiffTab } from "./tab-reference.js";
export default definePluginApp((app) => {
  app.commands.register({
    id: "toggle-diff",
    title: "Toggle diff panel",
    defaultShortcut: { key: "d", mod: true },
    isAvailable: (context) => context.threadId !== null,
    run(context) {
      context.experimental_openThreadFixedTab?.({
        tab: gitDiffTab,
        experimental_toggle: true,
      });
    },
  });
  app.slots.experimental_threadFixedTab({
    ...gitDiffTab,
    title: "Diff",
    experimental_shortcutCommandId: "toggle-diff",
    icon: "FileDiff",
    layout: "flush",
    component: DiffPanel,
    useVisible: useDiffVisible,
  });
  app.slots.experimental_threadContextSegment({
    id: "changes",
    title: "Changed files",
    component: ComposerGitSegment,
    useVisible: useComposerGitVisible,
  });
});
