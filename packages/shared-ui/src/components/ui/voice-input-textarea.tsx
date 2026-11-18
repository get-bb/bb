import {
  createContext,
  useContext,
  type ComponentPropsWithRef,
  type ComponentType,
} from "react";

export interface VoiceInputTextareaProps extends Omit<
  ComponentPropsWithRef<"textarea">,
  "value" | "defaultValue" | "onChange" | "children"
> {
  value: string;
  onValueChange: (value: string) => void;
  onVoiceInputActiveChange?: (active: boolean) => void;
}

const VoiceInputTextareaContext =
  createContext<ComponentType<VoiceInputTextareaProps> | null>(null);

export const VoiceInputTextareaProvider = VoiceInputTextareaContext.Provider;

function HostedVoiceInputTextarea({
  host: Host,
  ...props
}: VoiceInputTextareaProps & {
  host: ComponentType<VoiceInputTextareaProps>;
}) {
  return <Host {...props} />;
}

export function VoiceInputTextarea({
  onValueChange,
  onVoiceInputActiveChange,
  ...props
}: VoiceInputTextareaProps) {
  const hostTextarea = useContext(VoiceInputTextareaContext);
  if (hostTextarea) {
    return (
      <HostedVoiceInputTextarea
        {...props}
        host={hostTextarea}
        onValueChange={onValueChange}
        onVoiceInputActiveChange={onVoiceInputActiveChange}
      />
    );
  }
  return (
    <textarea
      {...props}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
