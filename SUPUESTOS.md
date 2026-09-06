# SUPUESTOS — bb wn

Valores asumidos sin preguntar, como se ordenó. Cada uno es reversible y aquí
queda dicho dónde se cambia.

| # | Supuesto | Valor | Dónde se cambia |
|---|---|---|---|
| A1 | Nombre de producto | `bb wn` | override win en `run-electron-builder.mjs` |
| A2 | appId | `cl.bb.wn` | ídem |
| A3 | Directorio de datos | `%APPDATA%/bb` | resolución de rutas del host-daemon |
| A4 | Firma de código | `sign:false` | no hay certificado; ver K1 |
| A5 | Shell por defecto | `powershell.exe -NoLogo -NoProfile` | `resolveDefaultTerminalShell()` |
| A6 | Directorio de pruebas | `C:\bb-test` | `qa/CHECKLIST-WIN11.md` |
| A7 | Arquitectura | x64 únicamente | target de electron-builder |
| A8 | Instalador | NSIS por usuario (`perMachine:false`) | bloque `nsis` |
| A9 | Versión del release | `v1.0.0-win` | tag del Release |
| A10 | Cuenta del fork | `zqkra` (`gh` ya autenticado) | remoto `fork` |

## Por qué `-NoProfile` (A5)

No es un descuido: el perfil de PowerShell del usuario puede imprimir banners,
cambiar la codificación o alterar el `PATH`, y eso hace la salida del terminal no
determinista y los tests inestables. Si algún día se quiere respetar el perfil
del usuario, debe ser una opción explícita, no el defecto.

## Por qué NSIS por usuario (A8)

`perMachine:false` instala sin pedir UAC. Un instalador por máquina exige
elevación, y para un primer entregable descargable eso es fricción sin ganancia.

## Supuestos que NO se hicieron

- **No se asumió que `%APPDATA%` sea escribible** ni que exista. El código debe
  degradar con un error legible, no reventar.
- **No se asumió paridad de `/proc`.** Windows no expone el cwd de un proceso de
  forma barata; se prohibió expresamente a S4 fingir que sí.
- **No se asumió que los symlinks funcionen.** En Windows requieren privilegio o
  Developer Mode; las junctions de directorio no. Está marcado como riesgo.
