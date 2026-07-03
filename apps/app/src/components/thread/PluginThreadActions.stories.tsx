import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import type { PluginThreadActionContribution } from "@/hooks/queries/plugin-contribution-queries";
import { PluginThreadActionButtons } from "./PluginThreadActions";

export default {
  title: "thread/Plugin thread actions",
};

const runTests: PluginThreadActionContribution = {
  pluginId: "small-ux-pack",
  id: "run-tests",
  title: "Run tests",
  icon: "ListTodo",
  confirm: "Send a test-run request to this thread?",
};

const syncIssues: PluginThreadActionContribution = {
  pluginId: "linear",
  id: "sync-issues",
  title: "Sync issues",
  // Unknown icon hints (plugins send freeform strings) fall back to Zap.
  icon: "beaker",
  confirm: null,
};

// Plugin-contributed thread actions render as outline buttons in the thread
// header, before the workspace-open and git actions. While one runs, every
// plugin action disables and the in-flight button shows a spinner.
export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="idle" hint="known icon · unknown icon falls back to Zap">
        <div className="flex items-center gap-2">
          <PluginThreadActionButtons
            actions={[runTests, syncIssues]}
            pendingActionKey={null}
            onRun={() => {}}
          />
        </div>
      </StoryRow>
      <StoryRow
        label="pending"
        hint="Run tests is in flight: spinner + all plugin actions disabled"
      >
        <div className="flex items-center gap-2">
          <PluginThreadActionButtons
            actions={[runTests, syncIssues]}
            pendingActionKey="small-ux-pack/run-tests"
            onRun={() => {}}
          />
        </div>
      </StoryRow>
    </StoryCard>
  );
}
