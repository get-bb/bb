import { useState } from "react";
import { View } from "react-native";
import { Button, ListRow, Sheet, Text, useSheet } from "@/ui";
import { usePickerSheetMaxHeight } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";
import { RemotePathBrowser } from "./RemotePathBrowser";

interface PathPickerProps {
  hostId: string | null;
  hostName?: string | null;
  /** The project checkout on that host (the default when `value` is null). */
  defaultPath: string | null;
  /** Null = work in the project checkout. */
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
}

/**
 * Unmanaged-workspace folder picker: defaults to the project checkout, or
 * any absolute folder on the machine through the remote path browser.
 */
export function PathPicker({
  hostId,
  hostName = null,
  defaultPath,
  value,
  onChange,
  disabled,
}: PathPickerProps) {
  const sheet = useSheet();
  const maxHeight = usePickerSheetMaxHeight();
  const [browsed, setBrowsed] = useState<string | null>(null);
  const [presentCount, setPresentCount] = useState(0);
  const label = value ?? (defaultPath ? "Project checkout" : "Folder");
  return (
    <>
      <PickerTrigger
        icon="Folder"
        label={label}
        onPress={sheet.present}
        disabled={disabled || hostId === null}
        testID="path-picker"
        accessibilityLabel="Workspace folder"
      />
      <Sheet
        controller={sheet}
        title="Workspace folder"
        layout="scroll"
        maxDynamicContentSize={maxHeight}
        onOpenChange={(open) => {
          if (open) setPresentCount((count) => count + 1);
        }}
      >
        <ListRow
          title="Project checkout"
          subtitle={
            defaultPath ?? "The project's folder on the selected machine"
          }
          leading="FolderGit"
          selected={value === null}
          onPress={() => {
            sheet.dismiss();
            onChange(null);
          }}
          testID="path-picker-default"
        />
        <View className="gap-3 px-4 pb-2 pt-3">
          <Text variant="caption">
            Or run in another folder on {hostName ?? "the machine"}:
          </Text>
          <View className="flex-row items-center gap-2">
            <Text variant="mono" numberOfLines={2} className="flex-1 text-xs">
              {browsed ?? "…"}
            </Text>
            <Button
              size="sm"
              variant="secondary"
              disabled={browsed === null}
              onPress={() => {
                if (browsed === null) return;
                sheet.dismiss();
                onChange(browsed);
              }}
              testID="path-picker-confirm"
            >
              Use this folder
            </Button>
          </View>
          {hostId !== null ? (
            <RemotePathBrowser
              key={`${hostId}:${presentCount}`}
              hostId={hostId}
              initialPath={value ?? defaultPath}
              onDirectoryChange={setBrowsed}
              inSheet
              testID="path-picker-browser"
            />
          ) : null}
        </View>
      </Sheet>
    </>
  );
}
