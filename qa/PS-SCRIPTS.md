# Inventario `.sh` → `.ps1` (Windows nativo)

El repo contiene 6 scripts `.sh` (excluyendo `node_modules`). Ninguno se borra:
macOS y Linux siguen siendo plataformas de primera. Solo los que un QA necesita
en Windows tienen gemelo `.ps1`, y viven bajo `qa/scripts/` porque `scripts/` de
la raíz es de S7, `apps/desktop` es de S6 y el resto pertenece a otros equipos:
un gemelo colocado junto al `.sh` original sería una edición fuera de ámbito y
un conflicto de merge seguro. Si el coordinador prefiere gemelos hermanos
(`foo.ps1` junto a `foo.sh`), estos ficheros están listos para mover.

Estado de verificación: **revisado línea a línea, NO ejecutado**. En este VPS
Ubuntu no hay PowerShell (`command -v pwsh powershell` no devuelve nada), así
que ningún `.ps1` de este repo puede probarse aquí. La verdad Windows la da el
runner `windows-latest` (`win-native.yml`).

## Tabla

| `.sh` | Qué hace | ¿Hace falta en Windows? | Gemelo / decisión |
|---|---|---|---|
| `.bb-env-setup.sh` | Aprovisiona el entorno dev: comprueba `pnpm` y `package.json`, corre `pnpm install` sin abortar al primer fallo | **Sí**: es el paso "instalar dependencias" del QA en Windows | `qa/scripts/bb-env-setup.ps1`, equivalencia 1:1 verificada por lectura |
| `scripts/provider-corpus/snapshot-rows.sh` | Puertas del corpus de providers: `compare` (por defecto) o `write`, exige `BB_PROVIDER_CORPUS_DIR` con `manifest.json`, corre `turbo run test:provider-corpus --filter=@bb/server`, vuelca `rows-last-run.json` y `perf-last-run.md` | **Sí**: las puertas del corpus también se corren desde Windows | `qa/scripts/snapshot-rows.ps1`, misma interfaz (`write`/`compare`), mismas variables de entorno, mismos ficheros de salida |
| `.github/actions/setup-workspace/install-pnpm.sh` | Instala el binario pinnado de pnpm en runners Linux/macOS (descarga + sha256) con `bash`, `curl`, `sha256sum`/`shasum` | **No**: en Windows el runner usa `corepack prepare pnpm --activate` (ver `win-native.yml`, paso "Set up pnpm"). Un gemelo duplicaría el camino | Sin gemelo. Dueño: S7 (CI) |
| `apps/mobile/e2e/scripts/ci-run-flows.sh` | Corre flujos Maestro contra un simulador iOS (`xcrun simctl`, app Release + backend) | **No**: exige macOS (simulador) y toolchain Maestro/Java; no es ejecutable ni significativo en Windows | Sin gemelo |
| `apps/server/src/assets/install-machine.sh` | Enrola una máquina macOS/Linux (launchd/systemd): descarga `bb-app.tgz`, verifica sha256, registra el servicio | **No desde QA**: el enrolamiento Windows es superficie de producto (instalador NSIS + servicio Windows), no un gemelo de este script. Además dice literalmente `supports macOS and Linux only` | Sin gemelo. Necesita coordinación: equipos de daemon/desktop para el camino Windows real |
| `scripts/provider-recordings/convert-claude-transcripts-sample.sh` | Re-construye fixtures desde transcripciones privadas `~/.claude/projects` con `mktemp`, `trap`, `find` | **No**: herramienta dev de un solo uso con datos privados; la línea S7 decide si quiere gemelo | Sin gemelo. Dueño: S7 |

## Ficheros nuevos en `qa/scripts/`

| Fichero | Origen | Notas |
|---|---|---|
| `bb-env-setup.ps1` | Gemelo de `.bb-env-setup.sh` | Diferencia deliberada nº 1: resuelve la raíz del repo desde `$PSScriptRoot` en vez de asumir el CWD (en Windows se suele lanzar con doble clic o desde otra carpeta). Diferencia nº 2: `pnpm install` se invoca como `pnpm.cmd` explícito para no depender de la resolución PATHEXT. Todo lo demás (prefijo `[bb-env-setup]`, continuar tras un paso fallido avisando con el exit code) es idéntico |
| `snapshot-rows.ps1` | Gemelo de `scripts/provider-corpus/snapshot-rows.sh` | Misma interfaz (`-Mode compare|write`, `compare` por defecto), mismas env (`BB_PROVIDER_CORPUS_DIR`, `BB_PROVIDER_CORPUS_ALLOWLIST`, `BB_PROVIDER_CORPUS_SNAPSHOT_DIR`, `BB_PROVIDER_CORPUS_ROW_CLASSES`, `BB_PROVIDER_CORPUS_SNAPSHOT`), mismo `turbo run test:provider-corpus --filter=@bb/server`, mismos vuelcos. `set -euo pipefail` se traduce a `$ErrorActionPreference = 'Stop'` + comprobación explícita de `$LASTEXITCODE` tras cada comando nativo |
| `collect-evidence.ps1` | Nuevo, sin `.sh` previo | Recoge en local lo mismo que el workflow recoge en CI: `00-host.txt` (SO, node, PowerShell) y `90-tasklist.txt` + `91-processes.csv`. Los `10/20/30/40-*.txt` se generan re-corriendo los comandos documentados en `qa-evidence/README.md` con `Tee-Object` |

`.gitattributes` ya fuerza CRLF en `*.ps1`: no hay que configurar nada al
añadir estos ficheros.
