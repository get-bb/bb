import { SettingsSection } from "@/components/ui/settings-section";
import { MicrophonePreferences } from "./MicrophonePreferences";

export function VoiceInputSettingsSection() {
  return (
    <SettingsSection title="Voice Input">
      <MicrophonePreferences open={false} activeStream={null} />
    </SettingsSection>
  );
}
