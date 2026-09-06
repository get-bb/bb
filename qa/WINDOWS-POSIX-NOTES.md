# Supuestos POSIX en `tests/**` que fallarían en el runner Windows

Repaso pedido por S8. Estado: **revisado en Linux, no probado en Windows**.
Cada hallazgo dice si se arregló aquí (archivos míos: `tests/**`) o si necesita
coordinación (comportamiento de producto o archivos de otro equipo). Los
arreglos aplicados no cambian el comportamiento en Linux: se verificaron con la
suite `@bb/qa` y el typecheck de `@bb/integration-tests`.

## Arreglado aquí

- `tests/qa/scripts/run-root-command.mjs` — `run()` lanzaba `pnpm`/`turbo` con
  `shell: false`. En Windows `pnpm` es un shim `pnpm.cmd` y sin shell el spawn
  falla con ENOENT, así que `standalone:start|stop|cleanup` no arrancaban.
  Ahora `shell: process.platform === "win32"` (en Linux idéntico a antes).
  El `ps -o ppid=` de `readParentPid` ya degradaba bien sin `ps` (cae a
  `process.ppid`), no se tocó.
- `tests/integration/vitest.config.ts:13` — `BB_DATA_DIR: "/tmp/bb-integration-test"`
  fijo. En Windows `/tmp/...` cuelga de la raíz de la unidad actual y no es el
  temp del usuario. Ahora `path.join(tmpdir(), "bb-integration-test")`
  (en este Linux `tmpdir()` es `/tmp`: idéntico).
- `tests/qa/test/spawn-logged-process.test.ts` — etiquetas `/tmp/standalone-server-data`
  y `/tmp/standalone-server.log` pasadas como `dataDir`/`logPath`. Ahora bajo
  `tmpdir()`. En Linux el valor es el mismo; en Windows ya no apuntan a la raíz
  de la unidad.
- `tests/qa/test/standalone-restart-command.test.ts` — los 4 tests que ejecutan
  `sh -c` (`runShellCommand`, `runRestartProviderEnvBlock`, desacoples reales
  del daemon) no pueden pasar en Windows: no hay `sh`, ni `kill`, ni el bloque
  `curl | jq` que el comando generado asume. Se marcan con
  `it.runIf(process.platform !== "win32")`: en Linux corren igual, en Windows
  se saltan en vez de romper la suite. El comando POSIX generado sigue
  cubierto por los tests de cadena, que sí son portables.
- `tests/qa/test/standalone-restart-command.test.ts` — rutas `/tmp/bb root`,
  `/tmp/bb logs/...`, `/tmp/bb-restart.pid` usadas como entrada y como
  subcadena esperada. Ahora bajo `tmpdir()` con el mismo basename (se conserva
  el espacio a propósito: cubre el entrecomillado).

## Revisado y sin bug (no tocar)

- `tests/qa/src/shared.ts` (`loadDotEnv`) — parte por `split("\n")`, pero clave
  y valor salen de una línea ya pasada por `trim()`, que come el `\r`. Un `.env`
  con CRLF (Notepad) se parsea bien. Sin cambio.
- `tests/qa/src/shared.ts` (`listStandaloneProcesses`, `listOpenFilePids`) y
  `tests/integration/global-setup.ts` (`listOpenFilePids`) — parten salida de
  `ps`/`lsof` por `"\n"`. En Windows esos binarios no existen y ambas funciones
  ya devuelven `[]`/`""` ante `ENOENT`, así que el `\n` nunca ve un CRLF.
  El problema real es otro (siguiente sección), no el salto de línea.
- Escritor/lector del record scripted-echo (`provider-bridge.ts:recordRequest`,
  `helpers/scripted-echo.ts:33`, `runtime-test-harness.ts:read`) — el escritor
  añade `\n` explícito con `appendFileSync` (Node no traduce EOL) y
  `* text=auto eol=lf` impide que git convierta el `.jsonl`. Simétrico en
  Windows. Sin cambio.
- `tests/integration/mobile-e2e/connect-stub.ts:612,626,630` — los `\r\n` son
  protocolo HTTP deliberado, no EOL de fichero. Sin cambio.
- No hay `toMatchSnapshot` / `toMatchFileSnapshot` / `toMatchInlineSnapshot` en
  `tests/**`: el riesgo clásico "snapshot con `\n` leído con CRLF" no aplica
  hoy. Si alguien añade snapshots de contenido de fichero, normalizar con
  `replaceAll("\r\n", "\n")` antes de comparar.
- `killProcess` (`SIGTERM`→`SIGKILL`, `process.kill(pid, 0)`) — en Windows Node
  emula ambas señales con `TerminateProcess`; el sondeo con señal 0 funciona.
  Sin cambio.
- `spawnLoggedProcess` con `command: "node"` (`start.ts`) — `node.exe` resuelve
  por PATHEXT sin shell. Sin cambio.

## Necesita coordinación (no es `tests/**` o es decisión de producto)

- `tests/qa/src/shared.ts:556` (`lsof -t +D`) y `:605` (`ps eww -Ao
  pid=,command=`) — en Windows no hay `lsof` ni `ps`, así que la limpieza de
  huérfanos (`cleanupStandaloneOrphans`, `cleanupStandaloneInstance`) es ciega
  allí: mata lo que conoce por pidfile y poco más. El camino real es
  `Get-CimInstance Win32_Process` (`ProcessId`, `ParentProcessId`,
  `CommandLine`; el cwd NO está expuesto, hace falta otra estrategia) o
  `tasklist`. Quién: equipo dueño del standalone QA / daemon (S2/S4).
- `tests/qa/src/shared.ts` (`buildDaemonRestartCommand`) — genera `sh` con
  `kill`, `. envfile`, `curl | jq`. El `RESTART_DAEMON_COMMAND` que
  `standalone:start` escupe no corre en PowerShell. Falta el gemelo PS
  (decisión de producto: mismo contrato en PowerShell o vía `bb` CLI). El
  runbook (`qa/manual-runbook.md`, ~40 usos de `curl|jq`) tiene el mismo
  problema para el operador Windows: `curl.exe` existe pero `jq` no viene con
  el SO. Quién: dueños de daemon/CLI.
- `tests/integration/vitest.config.ts` — el `BB_SERVER_PORT`/`BB_HOST_DAEMON_PORT`
  fijos (49161/49162) colisionan igual en todos los SO si hay dos runners en la
  misma máquina; no es específico Windows, se deja anotado.
- `spawn-logged-process.test.ts` (`useIsolatedStandaloneTmpDir`) — los tests
  fijan `TMPDIR` y esperan que `tmpdir()` lo vea. En Windows `os.tmpdir()`
  puede ignorar `TMPDIR` (usa `TEMP`/`TMP`/perfil): pendiente de confirmar en
  el runner; si falla, fijar las tres o `GetTempPath`. No se puede probar aquí.
- `apps/server/src/assets/install-machine.sh` — dice `supports macOS and Linux
  only` y registra launchd/systemd. El enrolamiento Windows (NSIS + servicio)
  es trabajo de daemon/desktop, no un gemelo QA. Ver `qa/PS-SCRIPTS.md`.
