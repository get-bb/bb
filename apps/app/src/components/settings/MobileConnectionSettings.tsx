import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { SettingsSection } from "@/components/ui/settings-section";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useClipboardCopy } from "@/lib/clipboard";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";
import { usePluginSlots } from "@/lib/plugin-slots";

function DirectConnectionInstructions() {
  const config = useSystemConfig();
  const configuredUrl = config.data?.serverAccess.effectiveUrl;
  const url =
    configuredUrl && !isLocalOnlyUrl(configuredUrl) ? configuredUrl : null;
  const { copied, copy } = useClipboardCopy({ text: url ?? "" });
  return (
    <div className="space-y-3 text-sm">
      <p className="text-subtle-foreground">
        Enter your server’s URL in the app. Your phone must be able to reach
        this address.
      </p>
      {url ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 break-all font-mono">{url}</span>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy URL"}
          </Button>
        </div>
      ) : config.isPending ? (
        <p role="status" className="text-subtle-foreground">
          Loading server address…
        </p>
      ) : config.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert">Could not load the server address.</p>
          <Button variant="outline" onClick={() => void config.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <p className="text-subtle-foreground">
          Use a LAN, Tailscale, or public server URL. You can set a shared
          address in{" "}
          <Link
            to="/settings/machines"
            className="underline underline-offset-2"
          >
            Machine access
          </Link>
          .
        </p>
      )}
    </div>
  );
}

export function MobileConnectionSettings() {
  const { settingsSections } = usePluginSlots();
  const sections = settingsSections.filter(
    (section) => section.experimental_page === "mobile",
  );
  const options = [
    ...sections.map((section) => ({
      value: `${section.pluginId}/${section.id}`,
      label: section.title ?? section.pluginId,
    })),
    { value: "direct", label: "Direct" },
  ];
  const [choice, setChoice] = useState<string | null>(null);
  const selected =
    options.find((option) => option.value === choice)?.value ??
    options[0]!.value;
  const section = sections.find(
    (entry) => `${entry.pluginId}/${entry.id}` === selected,
  );
  return (
    <SettingsSection
      title="Connect your phone"
      actionPlacement="inline"
      action={
        <OptionPicker
          label="Connection method"
          value={selected}
          options={options}
          onChange={setChoice}
          modal={false}
          align="end"
        />
      }
    >
      {section ? (
        <PluginSlotMount
          key={`${section.pluginId}/${section.id}/${section.generation}`}
          pluginId={section.pluginId}
          slotKind="settingsSection"
          slotId={section.id}
        >
          <section.component />
        </PluginSlotMount>
      ) : (
        <DirectConnectionInstructions />
      )}
    </SettingsSection>
  );
}
