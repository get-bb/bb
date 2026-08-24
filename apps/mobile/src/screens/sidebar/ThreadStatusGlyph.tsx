import {
  getThreadListIndicatorLabel,
  type ThreadListIndicatorKind,
} from "@bb/client-core";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { Icon, Spinner, type IconName } from "@/ui";

const GLYPH_SIZE = 18;

/**
 * The single trailing status glyph of a thread row (web `ThreadStatusGlyph`
 * in apps/app/src/components/sidebar/ThreadRow.tsx). Precedence lives in
 * `resolveThreadListIndicator`; this only maps a kind to a glyph.
 */
export function ThreadStatusGlyph({ kind }: { kind: ThreadListIndicatorKind }) {
  const { tokens } = useTheme();
  const label = getThreadListIndicatorLabel(kind) ?? undefined;
  const working = tokens.mutedForeground;
  const renderIcon = (name: IconName, color: string) => (
    <Icon
      name={name}
      size={GLYPH_SIZE}
      color={color}
      accessibilityLabel={label}
    />
  );
  switch (kind) {
    case "unread-error":
      return renderIcon("CircleX", tokens.destructiveText);
    case "waiting-for-input":
      return renderIcon("CircleQuestion", tokens.mutedForeground);
    case "working-draft":
      return renderIcon("Edit", working);
    case "workflow":
      return renderIcon("Workflow", working);
    case "background-agent":
      return renderIcon("UserRoundPlus", working);
    case "background-command":
      return renderIcon("Terminal", working);
    case "plan-mode":
      return renderIcon("ListTodo", working);
    case "goal":
      return renderIcon("Target", working);
    case "runtime":
      return (
        <View
          accessibilityLabel={label}
          style={{ width: GLYPH_SIZE, height: GLYPH_SIZE }}
          className="items-center justify-center"
        >
          <Spinner size="small" color={tokens.mutedForeground} />
        </View>
      );
    case "draft":
      return renderIcon("Edit", tokens.mutedForeground);
    case "unread-success":
      return (
        <View
          accessibilityLabel={label}
          className="h-2 w-2 rounded-full bg-muted-foreground/60"
        />
      );
    case "none":
      return null;
  }
}
