# DECISIONES — bb wn (port nativo Windows 11 x64)

Cada entrada: qué se decidió, qué se descartó y por qué. Sin preguntar al humano,
como se pidió. Fecha: 2026-09-06.

---

## D1. La máquina Windows es `windows-latest` de GitHub Actions

**Contexto.** El trabajo se ordenó desde un VPS de Contabo con Ubuntu 24.04. No
hay Windows en él y nunca lo habrá.

**Se comprobó, no se supuso.** La estación Windows del usuario (`sapphireos`)
está en la misma tailnet y responde a ICMP (71 ms, conexión directa). Pero se
sondearon los puertos 22, 5985, 5986 y 3389: **los cuatro cerrados**. Sin
servidor SSH, sin WinRM, sin RDP. Tailscale SSH no soporta Windows como
servidor. No es accesible para automatizar, y además el usuario pidió
explícitamente no usar su máquina.

**Decisión.** La verdad de Windows sale de los runners `windows-latest` del fork
`zqkra/bb-wn`. El runner reporta **Windows Server 2025, build 10.0.26100** — el
mismo número de build que Windows 11 24H2, es decir el mismo kernel y la misma
superficie de API para ConPTY, NSIS, Job Objects y semántica de rutas.

**Coste.** Cero: el fork es público y los minutos de Actions son gratis en repos
públicos, incluidos los de Windows. Si el fork pasara a privado, empezarían a
contar a ×2. No se cambiará la visibilidad.

**Lo que esto NO prueba, y se dice sin adornos.** Server 2025 no es Win11
Desktop. No prueba el doble clic en un escritorio real, ni el instalador NSIS
frente a SmartScreen/Defender, ni el comportamiento con un usuario interactivo
de verdad. Eso va a `qa/CHECKLIST-WIN11.md` para ejecución humana.

---

## D2. El modelo de los agentes: `pi` sobre `opencode-go`, muse-spark-1.3, xhigh

**Descartado:** `muse spark` como CLI propio — **no existe en esta máquina**. Era
un agente de Orca, que es una aplicación de escritorio Windows. Verificado con
`which`.

**Decisión.** `pi --provider opencode-go --model muse-spark-1.3-contributor
--thinking xhigh`, que es el mismo modelo por otra vía.

**Prohibición explícita.** `openrouter` tiene credencial guardada en esta máquina
y **factura dinero real**; el propio vault del usuario registra un incidente de
gasto por eso. Se prohibió a los workers cambiar de proveedor o modelo, y se les
exige declarar su runtime en la primera línea del informe para poder auditarlo.

---

## D3. Regla de oro del port: plataforma **inyectada**, no ambiental

**Decisión.** Toda función cuyo comportamiento dependa del sistema operativo
recibe `platform` como parámetro en vez de leer `process.platform` por dentro.

**Por qué.** No es purismo: es la única forma de que el comportamiento Windows
sea **testeable desde Linux**, que es donde se escribió todo el código. Una
función que lee `process.platform` por dentro solo se puede probar en Windows,
y cada vuelta de prueba en Windows cuesta ~11 minutos de CI. Una que lo recibe
se prueba en un segundo, en ambas ramas, aquí mismo.

Es la decisión que más determinó la calidad del resultado.

---

## D4. Los contratos se ensanchan, no se rompen

`HostPlatform` pasa de `"darwin" | "linux" | "wsl" | "unknown"` a incluir
`"win32"`. `BbDesktopInfo["platform"]` incluye `"windows"`.

**Es aditivo**, no un cambio de forma. Antes todo host Windows colapsaba a
`"unknown"`, que es precisamente el bug.

`HOST_DAEMON_PROTOCOL_VERSION` sube 183 → 184 porque `statusResponse.platform`
es un campo de cable y su dominio de valores cambió — lo exige el `AGENTS.md`
del propio repo. Se centralizó en el coordinador: se prohibió a los diez workers
tocar esa constante, porque diez incrementos paralelos colisionan.

---

## D5. `appId` y `productName` de Windows se inyectan, no se reescriben

**El problema.** `appId` y `productName` son globales en electron-builder. Poner
`cl.bb.wn` / `bb wn` en crudo en `electron-builder.config.json` cambiaría también
la identidad de los artefactos de macOS y Linux —rompiendo su actualizador— y
tumbaría `test/electron-builder-config.test.ts`, que fija los valores actuales.

**Decisión.** Se inyectan como override **solo para Windows** en
`scripts/run-electron-builder.mjs`, que ya genera un
`.electron-builder.generated.json` mezclando la config base con la lógica de
canal. mac y linux quedan intactos.

---

## D6. Diez workers en paralelo con propiedad de ficheros disjunta

**Descartado:** un único checkout compartido. Diez agentes haciendo `git add -A`
sobre el mismo árbol se pisan.

**Decisión.** Un worktree de git por worker, propiedad explícita de ficheros, y
prohibición de tocar nada fuera de la lista propia. Lo que un worker necesita de
ficheros ajenos va a "needs coordination" en su informe y lo enruta el
coordinador. Ya evitó un choque real: S2 empezó a tocar el folder-picker de S10
y se cortó en caliente.

**Prohibido a los workers:** añadir o quitar dependencias y tocar
`pnpm-lock.yaml`. Un cambio de lockfile desincroniza los once worktrees y el
runner de Windows a la vez.

---

## D7. Primero la sonda de Windows, después el código

**Decisión.** Antes de repartir trabajo se subió un workflow de sondeo con
`continue-on-error` en cada paso, para que **una sola ejecución devolviera toda
la superficie de fallo** en vez de pararse en el primer error.

**Rendimiento inmediato.** Encontró tres cosas que ninguna lectura desde Linux
habría dado:

1. `packages/bb-app/package.json` llevaba el mismo `os: [darwin, linux]` que
   `apps/desktop` — bloqueaba en el paquete que la app de escritorio empaqueta.
2. `plugin-build` rechaza **todos** los plugins builtin en Windows por un
   `startsWith(rootDir + "/")` con la barra a pelo. Seis instancias. Tumbaba el
   build entero.
3. `plugin-registry` colisiona `components\ui\toggle.tsx` con
   `components/ui/toggle.tsx` por mezclar separadores.

Ninguna era adivinable. Esto justificó abrir S11 sobre evidencia, no sobre
intuición.
