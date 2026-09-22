import { atom, useAtom } from "jotai";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
} from "@get-bb/plugin-sdk/app";
import { sidebarProviderIconColorsAtom } from "../preferences/atoms.js";

/** Open state for the dialog, so a menu item can open it and then close. */
export const providerIconColorsDialogOpenAtom = atom(false);

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;
const NEUTRAL_LIGHT = "#6b6b6b";
const NEUTRAL_DARK = "#a3a3a3";

/** A native color input only takes #rrggbb, so other tints start neutral. */
function pickerValue(color: string | undefined, neutral: string): string {
  return color !== undefined && HEX_COLOR_PATTERN.test(color) ? color : neutral;
}

type Appearance = "light" | "dark";

export function ProviderIconColorsDialog() {
  const [open, setOpen] = useAtom(providerIconColorsDialogOpenAtom);
  const [customColors, setCustomColors] = useAtom(
    sidebarProviderIconColorsAtom,
  );
  const { providers } = experimental_useProviders();

  function setColor(providerId: string, appearance: Appearance, value: string) {
    const brand = providers.find((provider) => provider.id === providerId)
      ?.strings?.iconTint;
    const current = customColors[providerId] ?? {
      light: pickerValue(brand?.light, NEUTRAL_LIGHT),
      dark: pickerValue(brand?.dark, NEUTRAL_DARK),
    };
    setCustomColors({
      ...customColors,
      [providerId]: { ...current, [appearance]: value },
    });
  }

  function resetColor(providerId: string) {
    const { [providerId]: _removed, ...rest } = customColors;
    setCustomColors(rest);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Provider icon colors</DialogTitle>
          <DialogDescription>
            A color set here wins over the theme and the Brand or Monochrome
            choice. Reset a provider to follow them again.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {providers.map((provider) => {
            const custom = customColors[provider.id];
            const brand = provider.strings?.iconTint;
            return (
              <li
                key={provider.id}
                className="flex items-center gap-3"
                data-provider-icon-color-row={provider.id}
              >
                <ProviderIcon
                  providerKind="agent"
                  provider={provider}
                  className="size-4"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {provider.displayName}
                </span>
                {(["light", "dark"] as const).map((appearance) => (
                  <label
                    key={appearance}
                    className="flex items-center gap-1 text-xs text-muted-foreground"
                  >
                    {appearance === "light" ? "Light" : "Dark"}
                    <input
                      type="color"
                      aria-label={`${provider.displayName} ${appearance} color`}
                      className="size-6 cursor-pointer rounded border border-input bg-transparent"
                      value={pickerValue(
                        custom?.[appearance] ?? brand?.[appearance],
                        appearance === "light" ? NEUTRAL_LIGHT : NEUTRAL_DARK,
                      )}
                      onChange={(event) =>
                        setColor(provider.id, appearance, event.target.value)
                      }
                    />
                  </label>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={custom === undefined}
                  aria-label={`Reset ${provider.displayName} color`}
                  onClick={() => resetColor(provider.id)}
                >
                  Reset
                </Button>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
