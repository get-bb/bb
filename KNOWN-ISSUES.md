# bb wn — problemas conocidos

Recopilado de los informes de los trece agentes que hicieron el port, sin
suavizar. La regla que se les impuso fue: **nunca afirmar un comportamiento de
Windows que no se haya ejecutado**. Lo que sigue respeta esa regla.

## La limitación que enmarca todo lo demás

El port se escribió íntegro en Linux. La única máquina Windows disponible fue
`windows-latest` de GitHub Actions (**Windows Server 2025, build 10.0.26100**,
el mismo kernel que Windows 11 24H2). Eso da compilación, tests y empaquetado
reales, pero **no** un escritorio interactivo.

Por eso el diseño obliga a inyectar la plataforma como parámetro en vez de leer
`process.platform`: hace que la rama de Windows sea comprobable desde Linux. Un
test que fija «se pidió lanzar `powershell.exe` con estos argumentos» es una
afirmación fuerte y verificable — pero **no es lo mismo** que «PowerShell
arrancó y escribió». Donde esa distinción importa, está dicho abajo.

---

## K1 — Sin firma de código

El instalador no está firmado (`sign:false`, no hay certificado). Windows
SmartScreen mostrará «Windows protegió su PC» en la primera ejecución.

**Workaround:** Más información → Ejecutar de todas formas. Para distribución
real hace falta un certificado EV de firma de código.

## K2 — Los permisos POSIX no protegen nada en Windows

`chmod 0600` sobre secretos, credenciales, host-id y descriptores es
**best-effort** en NTFS: Node solo aplica el bit de sólo-lectura; el control
real son las ACL, y Node no expone API para ellas.

Se decidió deliberadamente **no fingir protección**: el código no pretende que
el fichero esté endurecido. En Windows los secretos quedan protegidos sólo por
los permisos heredados del perfil del usuario.

**Consecuencia práctica:** en una máquina multiusuario, otro usuario con
permisos sobre el perfil podría leerlos. **Workaround:** usar `%APPDATA%` del
perfil (que es lo que se hace) y no compartir la cuenta de Windows.

## K3 — El cwd de un proceso no es barato en Windows

`Win32_Process` da PID, PPID, ExecutablePath y CommandLine, pero **no** el
directorio de trabajo. La enumeración usa tres estrategias combinadas: árbol por
PPID, coincidencia por CommandLine/ExecutablePath, y registro propio de los PID
que lanzamos nosotros.

Es **parcial a propósito** y el tipo lo refleja (`approximateCwd: true` en todo
resultado win32). Hay dos modos de error reales:

- **Sobre-coincidencia:** un proceso que sólo menciona el directorio en su línea
  de comandos puede contarse como si estuviera dentro.
- **Sub-coincidencia:** un proceso cuyo cwd es invisible y que no lanzamos
  nosotros no aparece.

**Workaround:** lanzar con `spawnPortableProcess` + `cwd`, que auto-registra el
PID, o registrarlo a mano.

Detalles adicionales en `packages/process-utils/known-issues.md`: los nombres
8.3 no casan con la forma larga, symlinks y junctions se comparan léxicamente
(pasar ruta canónica), y el reciclado rápido de PID puede mal-atribuir un
subárbol dentro de la ventana de un barrido.

**Mejora propuesta, no implementada:** Job Objects con
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` matan a los hijos aunque el padre caiga en
bruto. Requiere un helper nativo (`CreateJobObject`/`AssignProcessToJobObject`),
es decir una dependencia nueva — se dejó como propuesta explícita.

## K4 — La sonda CIM no tiene timeout

Paridad con el camino `lsof` de POSIX, que tampoco lo tiene. Un `powershell.exe`
colgado colgaría el barrido.

**Workaround:** ninguno automático. Si se observa, hay que añadir timeout.

## K5 — ConPTY no se ha ejecutado nunca de verdad

Todo el trabajo del terminal está verificado contra un adaptador de PTY falso.
Se afirma qué se pide lanzar, no que arranque. **Lo más expuesto es UTF-8**: si
`chcp 65001` no basta, acentos y caracteres de caja saldrán rotos y nadie lo ha
visto todavía.

`.github/workflows/win-smoke.yml` existe precisamente para cerrar esto: lanza un
ConPTY real, escribe texto con acentos y comprueba que vuelve intacto.

**Estado:** pendiente de su primera ejecución verde.

## K6 — El perfil de PowerShell sí se carga en la sonda de entorno

La sonda de entorno de ejecución **no** usa `-NoProfile`, a propósito, para
reflejar el `-ilc` de POSIX. El parseo por marcadores ignora el ruido del perfil.
El terminal interactivo sí usa `-NoProfile` por determinismo.

**Riesgo:** un perfil de usuario que escriba en stdout de forma agresiva podría
confundir al parseo. No observado.

## K7 — Casos límite de rutas que se dejaron conscientemente

- `isSameProjectPath` sobre rutas `\\?\` con y sin barra final devuelve `false`.
  Es la consecuencia honesta de **no re-normalizar** los prefijos `\\?\`, que es
  justo lo que Windows espera de ellos. Si se quiere igualdad ahí, hay que
  decidirlo explícitamente.
- `\\?\` a secas devuelve `false`; es un degenerado inválido de todas formas.
- `\\.\` y `\\?\` se tratan como equivalentes a efectos de contención en el
  watcher; suficiente para su uso.

## K8 — Symlinks y bits de ejecución

Crear symlinks en Windows requiere privilegio o Modo Desarrollador. El paquete
de workspace **nunca los crea** (los detecta por `lstat` y los salta), así que
no hay dependencia de privilegio. Pero:

- `chmod(file.mode)` sobre skills inyectadas **no preserva** el bit de
  ejecución POSIX en win32. La ejecutabilidad de `.sh`/`.cmd` de skills en
  Windows queda sin resolver.
- Los repos que contengan symlinks dependen de `core.symlinks` de git: sin Modo
  Desarrollador quedan como ficheros de texto con la ruta destino dentro.

## K9 — Directorio de datos en desarrollo

Sólo producción se redirige a `%APPDATA%/bb`. En modo desarrollo
(`NODE_ENV != production`) el directorio de datos sigue resolviéndose bajo el
home vía `@bb/config`.

## K10 — Actualizador automático sin cablear

El espacio de tags `desktop-win-v*` es deliberadamente distinto de
`desktop-v*`/`desktop-latest`, que el flujo de release upstream trata como
inmutables. No se ha comprobado que electron-builder emita `latest.yml` y
`.blockmap` con `--publish never` en Windows; si faltara `latest.yml`, el
release quedaría sin feed de actualización aunque el `.exe` esté.

**Workaround:** tras el primer release verde, inspeccionar los artefactos y
ajustar los globs.

## K11 — Cobertura de editores en «Abrir en…»

Sólo VS Code y VS Code Insiders tienen rutas conocidas en Windows
(`LOCALAPPDATA`/`ProgramFiles` y `Code.exe` directo). El resto de editores sólo
se detectan si están en el `PATH` vía `where.exe`. JetBrains Toolbox no está
mapeado en Windows.

Además, VS Code remoto se anuncia con sólo el CLI presente aunque falte `ssh`:
es **paridad exacta con macOS**, no un descuido.

## K12 — Diálogo de carpeta de respaldo

El respaldo en PowerShell usa `FolderBrowserDialog`, que requiere STA. El flag
`-STA` no se ha probado fuera de Linux. El camino principal es el diálogo nativo
de Electron, que sí es nativo en Windows.

## K13 — Lo que este montaje no puede probar nunca

Los runners son Windows Server sin escritorio interactivo. Queda fuera de
alcance y **debe hacerlo una persona** en un Windows 11 real, siguiendo
`qa/CHECKLIST-WIN11.md`:

- el doble clic sobre el instalador y el flujo de SmartScreen/Defender
- que la ventana de Electron abra sin pedir navegador
- desinstalación limpia
- comportamiento tras reinicio
