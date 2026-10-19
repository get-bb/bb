import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), "bb-browser-address-"));
try {
  await build({
    stdin: {
      contents: `import {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {BrowserAddressInput} from './components/secondary-panel/BrowserAddressInput';
        function App() {
          const [value, setValue] = useState('https://example.com/docs');
          return <><button>Before</button><BrowserAddressInput value={value}
            onChange={e => setValue(e.target.value)}/><button>After</button></>;
        }
        createRoot(document.getElementById('root')).render(<App/>);`,
      loader: "tsx",
      resolveDir: fileURLToPath(new URL("../../app/src", import.meta.url)),
    },
    outfile: join(directory, "renderer.js"),
    bundle: true,
    platform: "browser",
    jsx: "automatic",
  });
  await writeFile(
    join(directory, "index.html"),
    '<!doctype html><style>input{width:400px;font:16px monospace}body{margin:20px}</style><div id="root"></div><script src="renderer.js"></script>',
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      fileURLToPath(new URL("./fixtures/browser-address.mjs", import.meta.url)),
      directory,
    ],
    { env, stdio: "inherit", timeout: 60_000 },
  );
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (code !== 0) throw new Error(`Browser address smoke failed: exit ${code}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
