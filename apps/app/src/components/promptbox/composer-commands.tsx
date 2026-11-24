import { createContext, useContext } from "react";
import type { KeyboardCommandId } from "@bb/domain";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";

type OwnsCommand = (target: EventTarget | null) => boolean;

const ComposerCommandOwnerContext = createContext<OwnsCommand | null>(null);

export const ComposerCommandOwnerProvider =
  ComposerCommandOwnerContext.Provider;

export function useComposerCommand(
  command: KeyboardCommandId,
  run: () => void,
  isAvailable?: () => boolean,
): void {
  const ownsCommand = useContext(ComposerCommandOwnerContext);
  useAppCommandHandler(
    command,
    () => {
      run();
      return true;
    },
    0,
    ownsCommand !== null,
    ({ target }) =>
      (ownsCommand?.(target) ?? false) && (isAvailable?.() ?? true),
  );
}

export function ComposerCommand({
  command,
  run,
}: {
  command: KeyboardCommandId;
  run: () => void;
}) {
  useComposerCommand(command, run);
  return null;
}
