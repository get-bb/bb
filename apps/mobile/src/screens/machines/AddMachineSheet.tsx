import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Linking, View } from "react-native";
import { formatCountdown, type AddMachineSession } from "@/data/hosts";
import { useTheme } from "@/theme";
import {
  Button,
  Sheet,
  Spinner,
  Text,
  toast,
  type SheetController,
} from "@/ui";
import { HostStatusDot } from "../pickers";
import { pluginDetailHref } from "../shell/hrefs";

const MULTIPLE_DEVICES_DOCS_URL =
  "https://github.com/get-bb/bb/blob/main/docs/multiple-devices.md";

interface AddMachineSheetProps {
  controller: SheetController;
  /** The session from `useAddMachineSession()`; the caller's press handler runs `begin()` before presenting. */
  session: AddMachineSession;
}

/**
 * Add-a-machine pairing (web AddMachineDialog): mints a join code (and a
 * connect machine code when bb connect is paired), shows the installer
 * one-liner with Copy and an expiry countdown, and flips to "connected"
 * live when the new machine's daemon appears in the host list.
 */
export function AddMachineSheet({ controller, session }: AddMachineSheetProps) {
  const router = useRouter();
  const { tokens } = useTheme();
  const [copied, setCopied] = useState(false);
  const { presentation } = session;

  const copy = (command: string) => {
    void Clipboard.setStringAsync(command)
      .then(() => {
        setCopied(true);
        toast.success("Pairing command copied");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("Couldn't copy the command"));
  };

  return (
    <Sheet
      controller={controller}
      title="Add a machine"
      snapPoints={["70%"]}
      layout="scroll"
      onDismiss={session.end}
    >
      <View className="gap-4 px-4 pb-8 pt-2" testID="add-machine-sheet">
        <Text variant="caption">
          {presentation.kind === "unreachable"
            ? "Pair a machine to run projects and threads on it."
            : "Run this on the machine you want to add. It pairs the machine to this server and keeps it available for your projects."}
        </Text>

        {presentation.kind === "loading" ? (
          <View className="flex-row items-center gap-2">
            <Spinner size="small" />
            <Text variant="body" tone="muted">
              Creating a join code…
            </Text>
          </View>
        ) : presentation.kind === "error" ||
          presentation.kind === "connect-unavailable" ? (
          <View className="gap-2">
            <Text variant="body" tone="destructive">
              {presentation.kind === "connect-unavailable"
                ? "Remote access isn't ready yet."
                : presentation.message}
            </Text>
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              loading={session.minting}
              onPress={session.mint}
            >
              Try again
            </Button>
          </View>
        ) : presentation.kind === "unreachable" ? (
          <View className="gap-2 rounded-md border border-border bg-muted/40 p-3">
            <Text variant="body">Another machine cannot use this address.</Text>
            <Text variant="caption">
              The pairing command would target{" "}
              <Text variant="mono" className="text-xs">
                {presentation.serverUrl}
              </Text>
              , which points to the machine that runs it, not to this bb.{" "}
              {presentation.reason === "disabled"
                ? "The Connect plugin is disabled, so remote access is off. Enable it, then come back here to get a pairing command that works from anywhere."
                : "Set up remote access (bb connect) on the server first, then come back here to get a pairing command that works from anywhere."}
            </Text>
            <View className="flex-row flex-wrap items-center gap-2">
              {presentation.reason === "disabled" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => {
                    controller.dismiss();
                    router.push(pluginDetailHref("connect"));
                  }}
                >
                  Open the Connect plugin
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  Linking.openURL(MULTIPLE_DEVICES_DOCS_URL).catch(() => {
                    toast.error("Could not open the docs");
                  });
                }}
              >
                Other options
              </Button>
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <View className="rounded-md border border-border bg-muted/40 p-3">
              <Text
                variant="mono"
                className="text-xs"
                selectable
                testID="add-machine-command"
              >
                {presentation.command}
              </Text>
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                icon="Copy"
                disabled={session.expired}
                onPress={() => copy(presentation.command)}
                testID="add-machine-copy"
              >
                {copied ? "Copied" : "Copy"}
              </Button>
              {session.expired ? (
                <>
                  <Text variant="caption">Code expired</Text>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={session.minting}
                    onPress={session.mint}
                  >
                    Generate a new code
                  </Button>
                </>
              ) : session.remainingMs !== null ? (
                <Text variant="caption" className="tabular-nums">
                  Code expires in {formatCountdown(session.remainingMs)}
                </Text>
              ) : null}
            </View>
            <Text variant="caption">
              This installs bb, enrolls the daemon, and configures it to
              reconnect automatically on the other machine.
              {presentation.viaConnect
                ? " The command routes through bb connect, so it works from anywhere."
                : ""}
            </Text>
          </View>
        )}

        {presentation.kind === "unreachable" ? null : (
          <View className="flex-row items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
            {session.connectedNewHost !== null ? (
              <>
                <HostStatusDot connected />
                <Text
                  variant="body"
                  numberOfLines={1}
                  className="min-w-0 flex-1"
                >
                  {session.connectedNewHost.name} connected
                </Text>
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() => controller.dismiss()}
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Spinner size="small" color={tokens.mutedForeground} />
                <Text variant="body" tone="muted">
                  Waiting for the machine to connect…
                </Text>
              </>
            )}
          </View>
        )}
      </View>
    </Sheet>
  );
}
