import type { Host } from "@bb/domain";
import { useState } from "react";
import { View } from "react-native";
import { useRenameHost } from "@/data/hosts";
import { Button, Sheet, Text, toast, type SheetController } from "@/ui";
import { SheetInput } from "../pickers";

interface MachineRenameSheetProps {
  controller: SheetController;
  /** The machine being renamed; null keeps the sheet empty. */
  host: Host | null;
  onRenamed?: (host: Host) => void;
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Couldn't rename the machine.";
}

/** Rename sheet (web MachineRenameDialog): one field, inline error, Save. */
export function MachineRenameSheet({
  controller,
  host,
  onRenamed,
}: MachineRenameSheetProps) {
  return (
    <Sheet controller={controller} title="Rename machine" deferContent={false}>
      {host ? (
        // Keyed on the host so the draft and the mutation state reset per target.
        <RenameForm
          key={`${host.id}:${host.name}`}
          host={host}
          controller={controller}
          onRenamed={onRenamed}
        />
      ) : (
        <View className="px-4 pb-4 pt-2">
          <Text variant="caption">No machine selected.</Text>
        </View>
      )}
    </Sheet>
  );
}

function RenameForm({
  host,
  controller,
  onRenamed,
}: {
  host: Host;
  controller: SheetController;
  onRenamed?: (host: Host) => void;
}) {
  const renameHost = useRenameHost();
  const [name, setName] = useState(host.name);
  const trimmed = name.trim();
  const canSave =
    trimmed.length > 0 &&
    trimmed.length <= 100 &&
    trimmed !== host.name &&
    !renameHost.isPending;

  const save = () => {
    if (!canSave) return;
    renameHost.mutate(
      { hostId: host.id, name: trimmed },
      {
        onSuccess: (updated) => {
          controller.dismiss();
          toast.success(`Renamed to ${updated.name}`);
          onRenamed?.(updated);
        },
      },
    );
  };

  return (
    <View className="gap-3 px-4 pb-4 pt-2">
      <SheetInput
        value={name}
        onChangeText={setName}
        placeholder="Machine name"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={save}
        editable={!renameHost.isPending}
        invalid={renameHost.isError}
        testID="machine-rename-input"
      />
      {renameHost.isError ? (
        <Text variant="caption" tone="destructive">
          {describeError(renameHost.error)}
        </Text>
      ) : null}
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" onPress={controller.dismiss}>
          Cancel
        </Button>
        <Button
          disabled={!canSave}
          loading={renameHost.isPending}
          onPress={save}
          testID="machine-rename-save"
        >
          Save
        </Button>
      </View>
    </View>
  );
}
