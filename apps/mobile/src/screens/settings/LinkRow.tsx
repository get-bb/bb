import { useRouter, type Href } from "expo-router";
import { GroupedRow, type GroupedRowProps } from "@/ui";

export interface LinkRowProps extends Omit<GroupedRowProps, "onPress"> {
  /** Destination; the row pushes it on tap. */
  href: Href;
}

/**
 * A navigating grouped row: a plain `GroupedRow` whose tap pushes `href`,
 * with `onLongPress` (the screen's own `ActionSheet`) on both platforms.
 * Never a `Link.Preview` / `Link.Menu`: the native context menu removes the
 * wrapped row from the iOS accessibility tree, so VoiceOver and Maestro see
 * only the host. Keeps `leading` / `badge` in its own props so
 * `GroupedSection` insets the separator to the text column.
 */
export function LinkRow({ href, trailing = "chevron", ...row }: LinkRowProps) {
  const router = useRouter();
  return (
    <GroupedRow
      {...row}
      trailing={trailing}
      onPress={() => router.push(href)}
    />
  );
}
