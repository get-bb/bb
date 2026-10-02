import { createContext, useContext } from "react";
import type { KeyboardCommandId } from "@bb/domain";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";

type OwnsCommandTarget = (target: EventTarget | null) => boolean;

const ComposerCommandOwnerContext = createContext<OwnsCommandTarget | null>(
  null,
);

export const ComposerCommandOwnerProvider =
  ComposerCommandOwnerContext.Provider;

export function useComposerCommand(
  command: KeyboardCommandId,
  run: () => void,
): void {
  const ownsTarget = useContext(ComposerCommandOwnerContext);
  useAppCommandHandler(
    command,
    () => {
      run();
      return true;
    },
    0,
    ownsTarget !== null,
    ({ target }) => ownsTarget?.(target) ?? false,
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
