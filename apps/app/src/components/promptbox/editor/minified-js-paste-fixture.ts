/**
 * Deterministic pseudo-minified-JS fixture for composer paste performance
 * work. Real minified bundles (jquery.min.js ~90 KB, three.min.js ~600 KB,
 * app bundles 1 MB+) are a worst case for the prompt box because they are one
 * enormous line with almost no whitespace and a high density of characters
 * the editor treats as Markdown delimiters (`, _, *) and trigger characters
 * (/, @). This generator reproduces that shape reproducibly so measurements
 * can be compared across machines and runs.
 *
 * The output is a single line of syntactically JS-shaped text (not meant to
 * execute) built from a seeded PRNG, so the same (seed, size) always yields
 * byte-identical text.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDENTIFIER_HEADS = "abcdefghijklmnopqrstuvwxyz_$";
const IDENTIFIER_TAILS = "abcdefghijklmnopqrstuvwxyz0123456789_$";

export interface MinifiedJsFixtureOptions {
  /** Approximate size in UTF-16 code units; output ends at a fragment edge. */
  approximateLength: number;
  seed?: number;
}

export function generateMinifiedJsFixture({
  approximateLength,
  seed = 0x5eed,
}: MinifiedJsFixtureOptions): string {
  const random = mulberry32(seed);
  const pick = (alphabet: string): string =>
    alphabet[Math.floor(random() * alphabet.length)]!;
  const identifier = (): string => {
    let name = pick(IDENTIFIER_HEADS);
    const extraLength = Math.floor(random() * 6);
    for (let index = 0; index < extraLength; index += 1) {
      name += pick(IDENTIFIER_TAILS);
    }
    return name;
  };
  const number = (): string => String(Math.floor(random() * 100000));

  // Weighted fragment shapes approximating terser/esbuild output, including
  // the characters the composer's Markdown/trigger scanning reacts to.
  const fragments: Array<() => string> = [
    () => `var ${identifier()}=${identifier()}(${number()});`,
    () =>
      `function ${identifier()}(${identifier()},${identifier()}){return ${identifier()}*${identifier()}+${number()}}`,
    () =>
      `${identifier()}.${identifier()}=${identifier()}=>${identifier()}?${identifier()}:${number()};`,
    () =>
      `if(${identifier()}&&${identifier()}!==${number()}){${identifier()}(${identifier()})}`,
    () =>
      `${identifier()}[${number()}]=\`\${${identifier()}}${identifier()}\`;`,
    () => `const ${identifier()}=/${identifier()}\\d+/g;`,
    () => `${identifier()}("${identifier()}@${identifier()}.com",${number()});`,
    () =>
      `for(let ${identifier()}=0;${identifier()}<${number()};${identifier()}++){${identifier()}+=${identifier()}}`,
    () => `${identifier()}=${identifier()}_${identifier()}_${identifier()};`,
    () =>
      `try{${identifier()}()}catch(${identifier()}){${identifier()}(${identifier()})}`,
  ];

  let output = "";
  while (output.length < approximateLength) {
    output += fragments[Math.floor(random() * fragments.length)]!();
  }
  return output;
}
