/**
 * The Monaco we ship.
 *
 * `editor.main` is Monaco's own standalone-editor entry: the API plus its 59
 * contribution modules (find, folding, word navigation, sorting, suggest,
 * bracket matching, …) and the Monarch grammars for every language it knows.
 *
 * An earlier revision imported `editor.api` alone to save ~1.3 MB. That is
 * the API surface *without* the contributions, so the editor still opened and
 * still typed — while find, option+arrow word navigation, and the folding
 * commands silently did not exist. Contributions are the editor; only the
 * language *services* (completion and type checking for CSS, HTML, JSON, and
 * TypeScript) are optional here, and this entry does not pull them in: the
 * plugin has no language server, and Monaco's TypeScript checker sees only
 * the open file, so its "cannot find module" errors would be wrong.
 */
export * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/editor.main.js";
