import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopContextMenuTemplate,
  registerDesktopContextMenu,
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
  "replaceMisspelling" | "session"
> {
  addedDictionaryWords: string[];
  replacedMisspellings: string[];
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
  const replacedMisspellings: string[] = [];
  return {
    addedDictionaryWords,
    replacedMisspellings,
    replaceMisspelling(text) {
      replacedMisspellings.push(text);
    },
    session: {
      addWordToSpellCheckerDictionary(word) {
        addedDictionaryWords.push(word);
        return true;
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

  it("registers the native menu popup for context-menu events", () => {
    const webContents = {
      ...createFakeWebContents(),
      on: vi.fn(),
    } satisfies DesktopContextMenuWebContents;

    registerDesktopContextMenu({ webContents });

    const listener = webContents.on.mock.calls[0]?.[1];
    listener?.(
      undefined as never,
      createContextMenuParams({
        selectionText: "selected",
        editFlags: { ...DEFAULT_EDIT_FLAGS, canCopy: true },
      }),
    );

    expect(popup).toHaveBeenCalledOnce();
  });
});
