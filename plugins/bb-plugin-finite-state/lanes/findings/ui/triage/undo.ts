export interface UndoToken {
  file: string;
  beforeSha256: string;
  afterSha256: string;
  prior: unknown;
}

export class SessionUndoStack {
  readonly #tokens: UndoToken[] = [];

  get size(): number { return this.#tokens.length; }

  push(token: UndoToken): void { this.#tokens.push(token); }

  peek(): UndoToken | null { return this.#tokens.at(-1) ?? null; }

  accept(token: UndoToken): void {
    if (this.#tokens.at(-1) === token) this.#tokens.pop();
  }
}
