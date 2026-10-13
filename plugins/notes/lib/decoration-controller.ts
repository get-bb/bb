import type * as MonacoNs from "monaco-editor";
import {
  DecorationStyleSheet,
  resolveColor,
  type WorkbenchColors,
} from "./decoration-styles.js";
import {
  compileHighlightRules,
  findHighlightRanges,
  type CompiledHighlightRule,
} from "./highlight-rules.js";
import { builtinMarkdownSettings } from "./markdown-decorations.js";
import type { NotesSettings } from "./vscode-settings.js";

/**
 * Re-decoration is debounced because the rules run over the whole document
 * and typing would otherwise re-scan on every keystroke. Short enough to
 * feel immediate after a pause, long enough that a burst of typing does one
 * pass instead of dozens.
 */
const DEBOUNCE_MS = 120;

export interface DecorationContext {
  settings: NotesSettings;
  themeType: "light" | "dark";
  colors: WorkbenchColors;
  path: string;
}

/**
 * Keeps one editor's highlight decorations in step with its content, the
 * active theme, and the effective settings.
 *
 * Built-in Markdown rules are compiled ahead of the user's so the user's
 * CSS lands later in the stylesheet and wins where the two overlap — an
 * imported `#DONE` rule should beat the generic heading colour on the same
 * span.
 */
export class DecorationController {
  private readonly styles = new DecorationStyleSheet();
  private collection: MonacoNs.editor.IEditorDecorationsCollection | null =
    null;
  private rules: readonly CompiledHighlightRule[] = [];
  private context: DecorationContext | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly monaco: typeof MonacoNs,
    private readonly editor: MonacoNs.editor.IStandaloneCodeEditor,
  ) {}

  /**
   * Recompiles for a new document, theme or settings object. Clearing the
   * stylesheet matters on a theme change: a class name is a hash of the
   * declarations it was built from, so a cached class would otherwise keep
   * serving the previous theme's resolved `theme.*` colour.
   */
  update(context: DecorationContext): void {
    if (this.disposed) return;
    this.context = context;
    this.styles.reset();
    this.rules = [
      ...compileHighlightRules(
        builtinMarkdownSettings(context.themeType),
        { path: context.path, languageId: "markdown" },
        { skipFencedCode: true },
      ),
      ...compileHighlightRules(context.settings, {
        path: context.path,
        languageId: "markdown",
      }),
    ];
    this.apply();
  }

  /** Coalesces the re-scan that follows a content change. */
  schedule(): void {
    if (this.disposed) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.apply();
    }, DEBOUNCE_MS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.collection?.clear();
    this.collection = null;
  }

  private apply(): void {
    if (this.disposed) return;
    const context = this.context;
    const model = this.editor.getModel();
    if (context === null || model === null) return;

    const ranges = findHighlightRanges(this.rules, model.getLinesContent());
    const decorations: MonacoNs.editor.IModelDeltaDecoration[] = [];

    for (const range of ranges) {
      const className = this.styles.classFor(range.style, context.colors);
      const ruler = resolveColor(
        range.style.overviewRulerColor,
        context.colors,
      );
      if (className === null && ruler === undefined) continue;

      decorations.push({
        range: new this.monaco.Range(
          range.lineNumber,
          range.startColumn,
          range.lineNumber,
          range.endColumn,
        ),
        options: {
          // `inlineClassName` styles the text itself; a decoration carrying
          // only a ruler colour still needs to exist so the mark appears on
          // the scrollbar.
          ...(className === null ? {} : { inlineClassName: className }),
          ...(ruler === undefined
            ? {}
            : {
                overviewRuler: {
                  color: ruler,
                  position: this.monaco.editor.OverviewRulerLane.Right,
                },
              }),
          stickiness:
            this.monaco.editor.TrackedRangeStickiness
              .NeverGrowsWhenTypingAtEdges,
        },
      });
    }

    this.collection ??= this.editor.createDecorationsCollection([]);
    this.collection.set(decorations);
  }
}
