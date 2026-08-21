// The lazy KaTeX chunk. `markdown-katex-loader.ts` imports this module with a
// dynamic `import()` the first time a preview contains `$$` math, so the KaTeX
// renderer (~260 KB raw / ~64 KB brotli) and its stylesheet stay out of the
// static closure of the thread route. Keep this file to the two imports below:
// anything else added here rides along in the math chunk.
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

export default rehypeKatex;
