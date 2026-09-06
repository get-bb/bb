# Checklist QA manual — bb nativo en Windows 11 real

Un humano, una máquina Windows 11 x64 física o VM con GUI, sin WSL implicado.
Cada paso dice qué hacer y qué se espera ver; si lo observado difiere, es un
fallo y va al PR con su evidencia (`qa-evidence/README.md` dice dónde).

Prepara antes de empezar:

- Windows 11 x64 actualizado, sesión de usuario normal (no SYSTEM).
- Node.js `22.19.0` y pnpm `9.15.0` si vas a correr los pasos 1–2 desde fuente
  (son las versiones pinnadas en `win-native.yml`); para el instalador no hacen
  falta.
- Carpeta `C:\bb-test`: créala con 3–4 ficheros de texto (`nota.txt`,
  `datos.csv`, uno con eñe: `diseño.txt`). Sin git dentro a propósito: el paso 6
  debe funcionar con una carpeta normal.
- Decide dónde cae la evidencia de esta pasada: `qa-evidence/` del checkout o
  una carpeta aparte (`collect-evidence.ps1 -OutDir C:\bb-test\evidencia`).

## 1. Instalar dependencias (solo si validas desde fuente)

```powershell
pnpm install --frozen-lockfile 2>&1 | Tee-Object qa-evidence\10-install.txt
```

- Se espera: `pnpm install` termina con exit 0. Sin errores `ELIFECYCLE`, sin
  `node-gyp` rojo. Avisos amarillos de peer deps: aceptables, se adjuntan.
- Alternativa con el gemelo QA: `qa\scripts\bb-env-setup.ps1` (mismo efecto,
  log con prefijo `[bb-env-setup]`).
- Evidencia: `qa-evidence\10-install.txt`.

## 2. Typecheck + tests + build (solo desde fuente)

```powershell
pnpm run typecheck 2>&1 | Tee-Object qa-evidence\20-typecheck.txt
pnpm exec vitest run --reporter=basic packages/domain packages/process-utils apps/host-daemon apps/desktop 2>&1 | Tee-Object qa-evidence\30-tests.txt
pnpm run build 2>&1 | Tee-Object qa-evidence\40-build.txt
```

- Se espera: los tres con exit 0. En `30-tests.txt`, cero `FAIL`; anota el
  conteo `Test Files / Tests` al final del fichero.
- Si algo falla aquí, no sigas al instalador: abre issue con estos tres
  ficheros (ver `docs/filing-issues.md` del repo para el formato).

## 3. Instalar la app con doble clic

1. Consigue el instalador: `release\bb-<version>-x64.exe` (NSIS; el nombre
   exacto lo fija el build de `apps/desktop`, confirma la versión antes).
2. Haz **doble clic**. No lo ejecutes desde terminal: este paso valida la vía
   del usuario normal.
3. Se espera:
   - Si SmartScreen dice "Windows protected your PC" (build sin firmar): es lo
     esperado en un build interno; `More info` → `Run anyway`. En release
     firmada NO debe aparecer: si aparece, es fallo.
   - Asistente NSIS en español o inglés según el SO, ruta por defecto bajo
     `%LOCALAPPDATA%` o `Program Files` (anota cuál), barra de progreso,
     botón `Finish`/`Close` sin errores.
   - Al terminar hay entrada "bb" en el menú Inicio.

## 4. Primera ventana: Electron real, SIN navegador

1. Abre "bb" desde el menú Inicio (o deja marcada la casilla de abrir al final
   del instalador).
2. Se espera, por este orden:
   - Una **ventana de escritorio propia** con icono y título "bb". Tiene que
     ser Electron, no vale que se abra Edge/Chrome.
   - La ventana **NO** te pide abrir `http://localhost:38886` ni ninguna URL en
     el navegador. Si aparece cualquier "open in browser", es fallo directo
     del port (ese era el comportamiento WSL, prohibido aquí).
   - La ventana responde al primer clic en menos de ~5 s (anota el tiempo
     real que veas).
3. Captura: `qa-evidence\50-first-window.png` (nombre manual, ver README).

## 5. Abrir el proyecto `C:\bb-test`

1. Desde la app, abre la carpeta `C:\bb-test` (File → Open / selector según la
   UI real; anota el camino que seguiste).
2. Se espera:
   - Los ficheros (`nota.txt`, `datos.csv`, `diseño.txt`) listados sin
     mojibake: la `ñ` se ve como `ñ`.
   - Abrir `nota.txt` muestra su contenido. Editar y guardar funciona.
3. Opcional (rutas duras del port): repite con una copia en
   `C:\bb test\` (con espacio) y, si te atreves,
   `C:\proyectos\diseño\`. Anota cuál probaste.

## 6. Terminal PowerShell dentro de la app

1. Abre la terminal integrada de la app sobre `C:\bb-test`.
2. Ejecuta:

```powershell
$PSVersionTable.PSVersion
[Console]::OutputEncoding
Get-Location
'chcp' 65001 | Out-Null; 'diseño: ñ á é'
```

3. Se espera:
   - Es `powershell.exe` (no `cmd`, no bash): el prompt y `$PSVersionTable`
     lo confirman.
   - `Get-Location` es `C:\bb-test` (la terminal arranca en el proyecto).
   - La línea con eñes se imprime intacta (UTF-8; el `chcp 65001` es el camino
     documentado del port si la codepage por defecto rompe acentos).
   - Un comando largo (`dir -Recurse`) se puede interrumpir con `Ctrl+C` y la
     terminal sigue viva.

## 7. Cerrar la app: no queda nada vivo

1. Cierra la ventana (la X) y sal del todo (bandeja → Quit si hay icono
   residente; anota si lo hay).
2. Espera 10 s y corre:

```powershell
tasklist /FI "IMAGENAME eq bb.exe"
tasklist /FI "IMAGENAME eq electron.exe"
Get-Process -Name bb, electron -ErrorAction SilentlyContinue
```

3. Se espera: las tres consultas **vacías** (`INFO: No tasks are running` en
   `tasklist`, nada en `Get-Process`). Cualquier `bb.exe` o `electron.exe`
   huérfano es fallo (en Windows matar el padre NO mata a los hijos; el
   apagado limpio es requisito del port).
4. Guarda la prueba: `qa\scripts\collect-evidence.ps1` escribe
   `90-tasklist.txt` + `91-processes.csv`. Adjunta también captura del
   `tasklist` si hubo huérfanos.

## 8. Desinstalar limpio

1. Configuración → Aplicaciones → "bb" → Desinstalar (o el `Uninstall.exe`
   junto a la instalación, el que exista; anota cuál usaste).
2. Se espera:
   - Desinstalador sin errores; al terminar NO hay entrada "bb" en el menú
     Inicio ni en la lista de aplicaciones.
   - Repite el `tasklist` del paso 7: vacío.
   - La carpeta de instalación ya no existe. Tus datos de usuario pueden
     sobrevivir según producto (anota qué quedó bajo `%APPDATA%` /
     `%LOCALAPPDATA%`, no lo borres a mano antes de anotarlo).
3. Evidencia: `qa-evidence\92-tasklist-after-uninstall.txt` (copia del
   `tasklist` post-desinstalación) + captura del menú Inicio sin "bb".

## Cierre de la pasada

Marca cada paso `PASS` / `FAIL` / `NA` (con motivo) en el PR. Un `FAIL`
cualquiera invalida el veredicto de la pasada: no se promedia. Incluye
siempre: `00-host.txt` (SO exacto: `Caption`, `Version`, `OSArchitecture`),
los `*.txt` de los pasos que corriste, las capturas citadas y el
`tasklist.txt` del paso 7.
