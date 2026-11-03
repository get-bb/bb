import type {} from "micromark-extension-math";
import type {} from "remark-parse";
import type {
  Code,
  Construct,
  Effects,
  State,
  TokenizeContext,
} from "micromark-util-types";
import type { Processor } from "unified";

const DOLLAR = 36;
const BACKSLASH = 92;
const BACKTICK = 96;
const COMMA = 44;
const PERIOD = 46;
const CURRENCY_TERMINATORS = new Set([33, 41, 58, 59, 63]);

function isWhitespace(code: Code): boolean {
  return code === null || code < 0 || code === 32;
}

function isLineEnding(code: Code): boolean {
  return code !== null && code < -2;
}

function isDigit(code: Code): boolean {
  return code !== null && code >= 48 && code <= 57;
}

function tokenizeInlineDollarMath(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const self = this;
  return start;

  function start(code: Code): State | undefined {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    effects.consume(code);
    effects.exit("mathTextSequence");
    return afterOpen;
  }

  function afterOpen(code: Code): State | undefined {
    if (code === DOLLAR || isWhitespace(code)) return nok(code);
    if (isDigit(code)) {
      effects.enter("mathTextData");
      return leadingNumber(code);
    }
    return between(code);
  }

  function leadingNumber(code: Code): State | undefined {
    if (isDigit(code) || code === COMMA || code === PERIOD) {
      effects.consume(code);
      return leadingNumber;
    }
    if (isWhitespace(code) || (code !== null && CURRENCY_TERMINATORS.has(code)))
      return nok(code);
    return data(code);
  }

  function between(code: Code): State | undefined {
    if (code === null) return nok(code);
    if (isLineEnding(code)) {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return between;
    }
    if (code === DOLLAR) {
      if (isWhitespace(self.previous)) return nok(code);
      effects.enter("mathTextSequence");
      effects.consume(code);
      return afterClose;
    }
    effects.enter("mathTextData");
    return data(code);
  }

  function data(code: Code): State | undefined {
    if (code === BACKTICK) return nok(code);
    if (code === null || code === DOLLAR || isLineEnding(code)) {
      effects.exit("mathTextData");
      return between(code);
    }
    effects.consume(code);
    return code === BACKSLASH ? escaped : data;
  }

  function escaped(code: Code): State | undefined {
    if (code === DOLLAR || code === BACKSLASH) {
      effects.consume(code);
      return data;
    }
    return data(code);
  }

  function afterClose(code: Code): State | undefined {
    if (isDigit(code)) return nok(code);
    effects.exit("mathTextSequence");
    effects.exit("mathText");
    return ok(code);
  }
}

function previous(this: TokenizeContext, code: Code): boolean {
  return code !== DOLLAR || this.events.at(-1)?.[1].type === "characterEscape";
}

const inlineDollarMath: Construct = {
  name: "inlineDollarMath",
  tokenize: tokenizeInlineDollarMath,
  previous,
};

export function remarkInlineDollarMath(this: Processor): void {
  const data = this.data();
  const extensions =
    data.micromarkExtensions ?? (data.micromarkExtensions = []);
  extensions.push({ text: { [DOLLAR]: inlineDollarMath } });
}
