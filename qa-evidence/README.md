# qa-evidence — qué se recoge y dónde

`qa-evidence/` es la carpeta coherente donde cae toda la prueba Windows: la que
sube el CI como artefacto y la que adjunta el humano del
`qa/CHECKLIST-WIN11.md`. No se commitea (es salida, no fuente); el workflow la
genera de cero en cada run.

## Ficheros del runner (`windows-latest`, `win-native.yml`)

El job `probe` corre cada paso con `continue-on-error` y solo el gate final
falla el job, así que una pasada devuelve la superficie completa de fallos. Cada
paso vuelca con `Tee-Object` a su fichero:

| Fichero | Paso que lo produce | Qué demuestra |
|---|---|---|
| `00-host.txt` | Host facts | SO exacto (`Caption`, `Version`, `OSArchitecture`), `node -p "process.version + ..."` y `$PSVersionTable`. Sin esto el resto no es interpretable |
| `10-install.txt` | `pnpm install --frozen-lockfile` | Instalación de dependencias en Windows real |
| `20-typecheck.txt` | `pnpm run typecheck` | Tipos en Windows real |
| `30-tests.txt` | `vitest run packages/domain packages/process-utils apps/host-daemon apps/desktop` | Tests unitarios que deciden comportamiento Windows por plataforma inyectada |
| `40-build.txt` | `pnpm run build` | El build no rompe en win32 |
| `90-tasklist.txt` | Process snapshot (`tasklist /FO TABLE`, siempre) | Qué procesos quedaban vivos al final del job |

El workflow los sube como artefacto `win-probe-evidence-<run_number>` con
retención de 30 días. El resumen del job pinta `install / typecheck / tests /
build` con ✅/❌.

## Ficheros del humano (pasada `CHECKLIST-WIN11.md`)

| Fichero | Paso | Qué demuestra |
|---|---|---|
| `qa-evidence\10/20/30/40-*.txt` | Checklist 1–2 | Lo mismo que el CI, pero desde tu máquina (cubre "en mi Windows falla" cuando el runner está verde) |
| `50-first-window.png` | Checklist 4 | Ventana Electron propia, sin navegador |
| `90-tasklist.txt` + `91-processes.csv` | Checklist 7 | `tasklist` y `Get-Process` vacíos de `bb`/`electron` tras cerrar: prueba del apagado limpio |
| `92-tasklist-after-uninstall.txt` | Checklist 8 | `tasklist` tras desinstalar + nota de qué quedó bajo `%APPDATA%` / `%LOCALAPPDATA%` |
| Capturas de SmartScreen / NSIS / error que veas | El paso donde salga | Siempre con el texto de la ventana legible; recorta solo la zona sensible |

## Cómo generarlos en local

```powershell
qa\scripts\collect-evidence.ps1
qa\scripts\collect-evidence.ps1 -OutDir C:\bb-test\evidencia
```

Escribe `00-host.txt`, `90-tasklist.txt` y `91-processes.csv` en la carpeta
dada (`qa-evidence/` por defecto). Los `10/20/30/40` se generan corriendo los
comandos del checklist con `Tee-Object`, igual que el workflow. Las capturas se
hacen con `Win+Shift+S` o la herramienta Recortes y se guardan como `.png` con
los nombres de la tabla.

## Reglas

- Un `FAIL` invalida la pasada entera; no se promedian veredictos.
- Cada fichero de evidencia se cita en el PR con el paso del checklist al que
  pertenece. Evidencia sin paso asociado no cuenta.
- Si el runner está verde y tu máquina roja (o al revés), se abre issue con
  ambos `00-host.txt` lado a lado: la primera hipótesis siempre es diferencia
  de entorno, no de código.
