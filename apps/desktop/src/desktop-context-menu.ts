import {
  Menu,
  type ContextMenuParams,
  type Event,
  type MenuItemConstructorOptions,
  type Session,
} from "electron";

export interface DesktopContextMenuWebContents {
  on(
    eventName: "context-menu",
    listener: (event: Event, params: ContextMenuParams) => void,
  ): void;
  executeJavaScript(script: string): Promise<unknown>;
  insertText(text: string): Promise<void> | void;
  replaceMisspelling(text: string): void;
  session: Pick<
    Session,
    "addWordToSpellCheckerDictionary" | "setSpellCheckerEnabled"
  >;
}

export interface DesktopContextMenuSpellcheckContext {
  dictionarySuggestions: string[];
  misspelledWord: string;
  replacementMode: "electron-misspelling" | "selected-text";
}

export interface BuildDesktopContextMenuTemplateArgs {
  params: ContextMenuParams;
  spellcheckContext?: DesktopContextMenuSpellcheckContext | null;
  webContents: Pick<
    DesktopContextMenuWebContents,
    "executeJavaScript" | "insertText" | "replaceMisspelling" | "session"
  >;
}

export interface RegisterDesktopContextMenuArgs {
  webContents: DesktopContextMenuWebContents;
}

function pushSeparatorIfNeeded(template: MenuItemConstructorOptions[]): void {
  if (template.length === 0) {
    return;
  }
  if (template.at(-1)?.type === "separator") {
    return;
  }
  template.push({ type: "separator" });
}

function trimTrailingSeparator(
  template: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  if (template.at(-1)?.type !== "separator") {
    return template;
  }
  return template.slice(0, -1);
}

function getSpellcheckContextFromParams(
  params: ContextMenuParams,
): DesktopContextMenuSpellcheckContext | null {
  if (
    !params.isEditable ||
    !params.spellcheckEnabled ||
    params.misspelledWord.length === 0
  ) {
    return null;
  }
  return {
    dictionarySuggestions: params.dictionarySuggestions,
    misspelledWord: params.misspelledWord,
    replacementMode: "electron-misspelling",
  };
}

function selectedSpellcheckWord(params: ContextMenuParams): string | null {
  const word = params.selectionText.trim();
  if (word.length === 0 || word.length > 80 || /\s/u.test(word)) {
    return null;
  }
  return word;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSpellcheckLookupResult(
  value: unknown,
): DesktopContextMenuSpellcheckContext | null {
  if (!isRecord(value)) {
    return null;
  }
  const { dictionarySuggestions, misspelledWord } = value;
  if (
    typeof misspelledWord !== "string" ||
    !Array.isArray(dictionarySuggestions) ||
    dictionarySuggestions.some((suggestion) => typeof suggestion !== "string")
  ) {
    return null;
  }
  return {
    dictionarySuggestions,
    misspelledWord,
    replacementMode: "selected-text",
  };
}

function spellcheckLookupScript(word: string): string {
  return `globalThis.__bbDesktopSpellcheck?.getCorrectionContext(${JSON.stringify(word)}) ?? null`;
}

export async function resolveDesktopSpellcheckFallback({
  params,
  webContents,
}: BuildDesktopContextMenuTemplateArgs): Promise<DesktopContextMenuSpellcheckContext | null> {
  if (getSpellcheckContextFromParams(params) !== null || !params.isEditable) {
    return null;
  }
  const word = selectedSpellcheckWord(params);
  if (word === null) {
    return null;
  }
  try {
    return parseSpellcheckLookupResult(
      await webContents.executeJavaScript(spellcheckLookupScript(word)),
    );
  } catch {
    return null;
  }
}

export function buildDesktopContextMenuTemplate({
  params,
  spellcheckContext,
  webContents,
}: BuildDesktopContextMenuTemplateArgs): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  const resolvedSpellcheckContext =
    getSpellcheckContextFromParams(params) ?? spellcheckContext ?? null;

  if (resolvedSpellcheckContext !== null) {
    if (resolvedSpellcheckContext.dictionarySuggestions.length > 0) {
      for (const suggestion of resolvedSpellcheckContext.dictionarySuggestions) {
        template.push({
          label: suggestion,
          click: () => {
            if (
              resolvedSpellcheckContext.replacementMode ===
              "electron-misspelling"
            ) {
              webContents.replaceMisspelling(suggestion);
              return;
            }
            void webContents.insertText(suggestion);
          },
        });
      }
    } else {
      template.push({
        label: "No Spelling Suggestions",
        enabled: false,
      });
    }
    template.push({
      label: `Add "${resolvedSpellcheckContext.misspelledWord}" to Dictionary`,
      click: () => {
        webContents.session.addWordToSpellCheckerDictionary(
          resolvedSpellcheckContext.misspelledWord,
        );
      },
    });
    pushSeparatorIfNeeded(template);
  }

  if (params.isEditable) {
    const { editFlags } = params;
    template.push(
      { role: "undo", enabled: editFlags.canUndo },
      { role: "redo", enabled: editFlags.canRedo },
      { type: "separator" },
      { role: "cut", enabled: editFlags.canCut },
      { role: "copy", enabled: editFlags.canCopy },
      { role: "paste", enabled: editFlags.canPaste },
      { role: "delete", enabled: editFlags.canDelete },
      { type: "separator" },
      { role: "selectAll", enabled: editFlags.canSelectAll },
    );
    return trimTrailingSeparator(template);
  }

  if (params.selectionText.length > 0 && params.editFlags.canCopy) {
    template.push({ role: "copy", enabled: true });
  }
  if (params.editFlags.canSelectAll) {
    pushSeparatorIfNeeded(template);
    template.push({ role: "selectAll", enabled: true });
  }

  return trimTrailingSeparator(template);
}

async function showDesktopContextMenu({
  params,
  webContents,
}: RegisterDesktopContextMenuArgs & {
  params: ContextMenuParams;
}): Promise<void> {
  const spellcheckContext = await resolveDesktopSpellcheckFallback({
    params,
    webContents,
  });
  const template = buildDesktopContextMenuTemplate({
    params,
    spellcheckContext,
    webContents,
  });
  if (template.length === 0) {
    return;
  }
  Menu.buildFromTemplate(template).popup();
}

export function registerDesktopContextMenu({
  webContents,
}: RegisterDesktopContextMenuArgs): void {
  webContents.session.setSpellCheckerEnabled(true);
  webContents.on("context-menu", (_event, params) => {
    void showDesktopContextMenu({ params, webContents });
  });
}
