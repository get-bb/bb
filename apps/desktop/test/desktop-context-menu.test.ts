import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopContextMenuTemplate,
  registerDesktopContextMenu,
  resolveDesktopSpellcheckFallback,
  type DesktopContextMenuWebContents,
} from "../src/desktop-context-menu.js";

const popup = vi.fn();

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate(template: MenuItemConstructorOptions[]) {
      return { popup, template };
    },
  },
}));

const DEFAULT_EDIT_FLAGS = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canDelete: false,
  canSelectAll: false,
  canEditRichly: false,
} satisfies ContextMenuParams["editFlags"];

const DEFAULT_MEDIA_FLAGS = {
  inError: false,
  isPaused: false,
  isMuted: false,
  hasAudio: false,
  isLooping: false,
  isControlsVisible: false,
  canToggleControls: false,
  canPrint: false,
  canSave: false,
  canShowPictureInPicture: false,
  isShowingPictureInPicture: false,
  canRotate: false,
  canLoop: false,
} satisfies ContextMenuParams["mediaFlags"];

interface FakeWebContents extends Pick<
  DesktopContextMenuWebContents,
  "executeJavaScript" | "insertText" | "replaceMisspelling" | "session"
> {
  addedDictionaryWords: string[];
  executedScripts: string[];
  insertedTexts: string[];
  replacedMisspellings: string[];
  spellCheckerEnabledValues: boolean[];
}

function createContextMenuParams(
  overrides: Partial<ContextMenuParams> = {},
): ContextMenuParams {
  return {
    x: 0,
    y: 0,
    frame: null,
    linkURL: "",
    linkText: "",
    pageURL: "",
    frameURL: "",
    srcURL: "",
    mediaType: "none",
    hasImageContents: false,
    isEditable: false,
    selectionText: "",
    titleText: "",
    altText: "",
    suggestedFilename: "",
    selectionRect: { x: 0, y: 0, width: 0, height: 0 },
    selectionStartOffset: 0,
    referrerPolicy: { policy: "default", url: "" },
    misspelledWord: "",
    dictionarySuggestions: [],
    frameCharset: "utf-8",
    formControlType: "none",
    spellcheckEnabled: false,
    menuSourceType: "mouse",
    mediaFlags: DEFAULT_MEDIA_FLAGS,
    editFlags: DEFAULT_EDIT_FLAGS,
    ...overrides,
  };
}

function createFakeWebContents(): FakeWebContents {
  const addedDictionaryWords: string[] = [];
  const executedScripts: string[] = [];
  const insertedTexts: string[] = [];
  const replacedMisspellings: string[] = [];
  const spellCheckerEnabledValues: boolean[] = [];
  return {
    addedDictionaryWords,
    executedScripts,
    insertedTexts,
    replacedMisspellings,
    spellCheckerEnabledValues,
    executeJavaScript(script) {
      executedScripts.push(script);
      return Promise.resolve(null);
    },
    insertText(text) {
      insertedTexts.push(text);
    },
    replaceMisspelling(text) {
      replacedMisspellings.push(text);
    },
    session: {
      addWordToSpellCheckerDictionary(word) {
        addedDictionaryWords.push(word);
        return true;
      },
      setSpellCheckerEnabled(enabled) {
        spellCheckerEnabledValues.push(enabled);
      },
    },
  };
}

function clickMenuItem(item: MenuItemConstructorOptions | undefined): void {
  item?.click?.(undefined as never, undefined as never, undefined as never);
}

describe("desktop context menu", () => {
  it("offers spellcheck replacements for editable misspellings", () => {
    const webContents = createFakeWebContents();
    const template = buildDesktopContextMenuTemplate({
      webContents,
      params: createContextMenuParams({
        isEditable: true,
        spellcheckEnabled: true,
        misspelledWord: "teh",
        dictionarySuggestions: ["the", "tech"],
      }),
    });

    expect(template[0]).toMatchObject({ label: "the" });
    expect(template[1]).toMatchObject({ label: "tech" });

    clickMenuItem(template[0]);

    expect(webContents.replacedMisspellings).toEqual(["the"]);
  });

  it("offers renderer spellcheck replacements when Electron omits suggestions for selected prompt text", () => {
    const webContents = createFakeWebContents();
    const template = buildDesktopContextMenuTemplate({
      webContents,
      params: createContextMenuParams({
        isEditable: true,
        selectionText: "recieve",
      }),
      spellcheckContext: {
        dictionarySuggestions: ["receive", "relieve"],
        misspelledWord: "recieve",
        replacementMode: "selected-text",
      },
    });

    expect(template[0]).toMatchObject({ label: "receive" });
    expect(template[1]).toMatchObject({ label: "relieve" });

    clickMenuItem(template[0]);

    expect(webContents.insertedTexts).toEqual(["receive"]);
    expect(webContents.replacedMisspellings).toEqual([]);
  });

  it("looks up fallback spellcheck suggestions for a selected editable word", async () => {
    const webContents = {
      ...createFakeWebContents(),
      executeJavaScript: vi.fn().mockResolvedValue({
        dictionarySuggestions: ["receive"],
        misspelledWord: "recieve",
      }),
    } satisfies FakeWebContents;

    await expect(
      resolveDesktopSpellcheckFallback({
        webContents,
        params: createContextMenuParams({
          isEditable: true,
          selectionText: "recieve",
          spellcheckEnabled: false,
        }),
      }),
    ).resolves.toEqual({
      dictionarySuggestions: ["receive"],
      misspelledWord: "recieve",
      replacementMode: "selected-text",
    });
    expect(webContents.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining('"recieve"'),
    );
  });

  it("can add a misspelled word to the spellchecker dictionary", () => {
    const webContents = createFakeWebContents();
    const template = buildDesktopContextMenuTemplate({
      webContents,
      params: createContextMenuParams({
        isEditable: true,
        spellcheckEnabled: true,
        misspelledWord: "bbapp",
      }),
    });

    expect(template[0]).toMatchObject({
      label: "No Spelling Suggestions",
      enabled: false,
    });
    expect(template[1]).toMatchObject({
      label: 'Add "bbapp" to Dictionary',
    });

    clickMenuItem(template[1]);

    expect(webContents.addedDictionaryWords).toEqual(["bbapp"]);
  });

  it("keeps standard edit actions in editable context menus", () => {
    const webContents = createFakeWebContents();
    const template = buildDesktopContextMenuTemplate({
      webContents,
      params: createContextMenuParams({
        isEditable: true,
        editFlags: {
          ...DEFAULT_EDIT_FLAGS,
          canCopy: true,
          canPaste: true,
          canSelectAll: true,
        },
      }),
    });

    expect(template).toEqual([
      { role: "undo", enabled: false },
      { role: "redo", enabled: false },
      { type: "separator" },
      { role: "cut", enabled: false },
      { role: "copy", enabled: true },
      { role: "paste", enabled: true },
      { role: "delete", enabled: false },
      { type: "separator" },
      { role: "selectAll", enabled: true },
    ]);
  });

  it("does not show an empty menu for inert content", () => {
    const webContents = createFakeWebContents();

    expect(
      buildDesktopContextMenuTemplate({
        webContents,
        params: createContextMenuParams(),
      }),
    ).toEqual([]);
  });

  it("registers the native menu popup for context-menu events", async () => {
    const webContents = {
      ...createFakeWebContents(),
      on: vi.fn(),
    } satisfies DesktopContextMenuWebContents;

    registerDesktopContextMenu({ webContents });

    expect(webContents.spellCheckerEnabledValues).toEqual([true]);

    const listener = webContents.on.mock.calls[0]?.[1];
    listener?.(
      undefined as never,
      createContextMenuParams({
        selectionText: "selected",
        editFlags: { ...DEFAULT_EDIT_FLAGS, canCopy: true },
      }),
    );

    await Promise.resolve();

    expect(popup).toHaveBeenCalledOnce();
  });
});
