import type { Host } from "@bb/domain";
import { View } from "react-native";
import { useTheme } from "@/theme";
import {
  Icon,
  ListRow,
  Sheet,
  Text,
  useSheet,
  type SheetController,
} from "@/ui";
import { usePickerSheetMaxHeight } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";

interface HostPickerProps {
  hosts: readonly Host[];
  /** Selected machine, or null when the server picks (project default). */
  value: string | null;
  onChange: (hostId: string) => void;
  /**
   * Machines that hold a checkout of the current project. Null means every
   * machine qualifies (personal project). A connected machine outside this
   * set gets a "Set up on this machine" row when `onRequestSetup` is given,
   * else a disabled "Not set up for this project" row.
   */
  hostIdsWithSource: ReadonlySet<string> | null;
  primaryHostId: string | null;
  onRequestSetup?: (host: Host) => void;
  disabled?: boolean;
  /** Render only the sheet (the caller owns the trigger). */
  controller?: SheetController;
  hideTrigger?: boolean;
  testID?: string;
}

export function HostStatusDot({ connected }: { connected: boolean }) {
  const { tokens } = useTheme();
  return (
    <View
      className="h-2 w-2 rounded-full"
      style={{
        backgroundColor: connected ? tokens.success : tokens.mutedForeground,
      }}
      accessibilityLabel={connected ? "Online" : "Offline"}
    />
  );
}

/**
 * Machine picker for projects checked out on several hosts (mirrors the
 * machine-grouped part of the web EnvironmentPicker / MachinePicker):
 * connection dot, primary badge, and the guided setup entry for a machine
 * without a project source.
 */
export function HostPicker({
  hosts,
  value,
  onChange,
  hostIdsWithSource,
  primaryHostId,
  onRequestSetup,
  disabled,
  controller,
  hideTrigger = false,
  testID = "host-picker",
}: HostPickerProps) {
  const ownSheet = useSheet();
  const sheet = controller ?? ownSheet;
  const { tokens } = useTheme();
  const maxHeight = usePickerSheetMaxHeight();
  const selected = hosts.find((host) => host.id === value) ?? null;
  const triggerLabel = selected
    ? selected.name
    : (hosts.find((host) => host.id === primaryHostId)?.name ?? "Machine");
  return (
    <>
      {hideTrigger ? null : (
        <PickerTrigger
          icon="Laptop"
          label={triggerLabel}
          onPress={sheet.present}
          disabled={disabled || hosts.length === 0}
          tone={
            selected && selected.status !== "connected" ? "warning" : "default"
          }
          testID={testID}
          accessibilityLabel="Machine"
        />
      )}
      <Sheet
        controller={sheet}
        title="Machine"
        layout="scroll"
        maxDynamicContentSize={maxHeight}
      >
        {hosts.length === 0 ? (
          <View className="px-4 py-6">
            <Text variant="caption" className="text-center">
              No machines have connected to this server yet.
            </Text>
          </View>
        ) : null}
        {hosts.map((host) => {
          const connected = host.status === "connected";
          const hasSource =
            hostIdsWithSource === null || hostIdsWithSource.has(host.id);
          const isPrimary = host.id === primaryHostId;
          const isSelected = host.id === value;
          const subtitle = !connected
            ? "Offline"
            : !hasSource
              ? onRequestSetup
                ? "Not set up for this project · tap to set up"
                : "Not set up for this project"
              : hosts.length > 1 && isPrimary
                ? "Primary machine"
                : undefined;
          return (
            <ListRow
              key={host.id}
              title={host.name}
              subtitle={subtitle}
              leading={
                <View className="w-5 items-center">
                  <HostStatusDot connected={connected} />
                </View>
              }
              trailing={
                isSelected ? (
                  <Icon name="Check" size={18} color={tokens.foreground} />
                ) : !hasSource && connected && onRequestSetup ? (
                  <Icon name="Plus" size={18} color={tokens.mutedForeground} />
                ) : null
              }
              selected={isSelected}
              disabled={!connected || (!hasSource && !onRequestSetup)}
              onPress={() => {
                sheet.dismiss();
                if (!hasSource) {
                  onRequestSetup?.(host);
                  return;
                }
                onChange(host.id);
              }}
              testID={`${testID}-option-${host.id}`}
            />
          );
        })}
      </Sheet>
    </>
  );
}
