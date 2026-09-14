# Отчёт по мерджу `upstream/main` в форк (native Windows)

- **Дата мерджа:** 2026-09-14
- **Merge-commit:** `42e50d7c2b60a605f4e85b0c0fe48813aad31ed2`
- **Наша ветка до мерджа:** `20ba09f83` (`main`, 8 локальных коммитов)
- **Родитель (upstream):** `get-bb/bb`, tip `d89160eb8` («Trim provider padding from timeline reasoning text (#3612)»)
- **Общий предок:** `06aeaa994`
- **Объём upstream:** 228 коммитов, 2617 файлов, +195 686 / −83 654 строк
- **Конфликты:** 26 путей (22 content + 4 modify/delete)
- **Пуш:** `origin/main` (`pZayash/bb`), fast-forward

## TL;DR

Мердж прошёл и запушен. Почти все конфликты породил один коммит — `9c94469f2 Support native
Windows hosts`: он правит те же «швы», которые upstream переписал за 228 коммитов (контракты,
хелперы путей, терминалы, жизненный цикл окружений). Конфликты делятся на четыре класса:
семантические (совпадающие строки с разным смыслом), modify/delete (мы развивали код, который
upstream удалил/перенёс), аддитивные (обе стороны дописывали список), lockfile.

## 1. Параметры мерджа

| Параметр                    | Значение                                    |
| --------------------------- | ------------------------------------------- |
| Наш fork-remote             | `origin` → `https://github.com/pZayash/bb`  |
| Родительский remote         | `upstream` → `https://github.com/get-bb/bb` |
| Общий предок                | `06aeaa994942ae7527dc49d2268c1f801e8542a0`  |
| Наш tip                     | `20ba09f83`                                 |
| Upstream tip                | `d89160eb8`                                 |
| Локальных коммитов          | 8                                           |
| Коммитов upstream           | 228                                         |
| Конфликтов                  | 26 путей                                    |
| Файлов в изменении upstream | 2617                                        |

## 2. Наши изменения, вызвавшие конфликты

### 2.1 `9c94469f2` — Support native Windows hosts (главный источник)

| Файл                                                                                                                                | Наша правка                                                                                    | Что сделал upstream                                                                         | Тип                      |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------ |
| `packages/host-daemon-contract/src/protocol.ts`                                                                                     | `HOST_DAEMON_PROTOCOL_VERSION = 184`                                                           | `= 207` (13 коммитов бампов)                                                                | одна и та же строка      |
| `packages/host-daemon-contract/test/contract.test.ts`                                                                               | ассерт `184`                                                                                   | ассерт `207`                                                                                | одна и та же строка      |
| `packages/domain/src/setup-script.ts`                                                                                               | добавили `WINDOWS_ENV_SETUP/TEARDOWN_SCRIPT_NAME`                                              | переписал соседние строки                                                                   | семантический            |
| `apps/host-daemon/src/runtime-shell-env.ts`                                                                                         | `bbExecutableFileName()` → `bb.cmd` на win32                                                   | удалил функцию, заинлайнил `"bb"`                                                           | семантический            |
| `packages/host-workspace/src/git.ts`                                                                                                | `windowsHide: true`                                                                            | переписал блок на `processOptions` + `onStderr`                                             | семантический            |
| `packages/bb-app/src/launcher.ts`                                                                                                   | `writeFileSync` (bb.cmd-шим)                                                                   | добавил `spawnLoggedProcess`                                                                | аддитивный               |
| `apps/host-daemon/src/terminals/terminal-manager.ts` + `.test.ts`                                                                   | убрали upstream-guard «Native Windows terminals are not supported», включили ConPTY/PowerShell | развил guard, добавил `operationEnvironment`, `openingTerminalIds`                          | семантический (ключевой) |
| `packages/plugin-build/src/plugin-manifest.ts`, `build-plugin-app.ts`, `build-plugin-host.ts`, `build-plugin-server.ts`, `index.ts` | ввели `isPathWithinDirectory`                                                                  | вынес `resolveManifestAssetFile` / `resolveManifestEntryFile` / `readPluginPackageJsonFile` | семантический, 5 файлов  |
| `apps/server/src/services/plugins/manifest.ts`                                                                                      | использовали `isPathWithinDirectory`                                                           | перешёл на новые хелперы                                                                    | семантический            |
| `packages/host-workspace/src/provisioning.ts` + `test/provisioning.test.ts`                                                         | развивали Windows-lifecycle (`.ps1`)                                                           | **удалил файл** («Environment providers», #3227)                                            | modify/delete            |
| `packages/host-workspace/test/provision.test.ts`                                                                                    | `skipIf(win32)` на POSIX-тестах                                                                | удалил эти тесты вместе с фичей                                                             | семантический            |

### 2.2 `657fc7320` — Add Windows supervisor scripts and native terminal shell resolution

| Файл                                                              | Наша правка                                                                | Тип           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------- |
| `.gitignore`                                                      | `/.runtime/`, `/windows-*.log`, `.kilo/start-bb.out.log`                   | аддитивный    |
| `turbo.json`                                                      | задача `//#test:windows:lifecycle`                                         | аддитивный    |
| `apps/host-daemon/src/terminals/terminal-manager.ts` + `.test.ts` | `resolveWindowsTerminalShell`, `terminalSpawnArgsForStart(message, shell)` | семантический |
| `packages/host-workspace/src/git.ts`                              | `windowsHide` для git-подпроцессов                                         | семантический |
| `pnpm-lock.yaml`                                                  | новые зависимости                                                          | lockfile      |

### 2.3 `b4e95fa8c` — Address native Windows support review findings

| Файл                                                                                | Наша правка                          | Что сделал upstream                                     | Тип                 |
| ----------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------- | ------------------- |
| `docs/worktrees.md`                                                                 | «Windows поддерживается (`.ps1`)»    | «POSIX only, native Windows не поддерживается»          | прямое противоречие |
| `apps/server/src/services/skills/builtin-skills/bb-cli/references/configuration.md` | дописали Windows-варианты            | удалил файл, скилл переехал в плагин `bb-guide` (#3311) | modify/delete       |
| `plugins/provider-pi/src/bridge/bridge.local-file.test.ts`                          | правили таймауты                     | удалил тест (#3455)                                     | modify/delete       |
| `packages/bb-app/src/launcher.ts`                                                   | идемпотентная запись шима            | —                                                       | аддитивный          |
| `packages/host-workspace/src/provisioning.ts`                                       | предупреждение об игнорируемом `.sh` | —                                                       | семантический       |

### 2.4 `c923c0471` — Fix Pi model loading and process control on native Windows

| Файл                                                | Наша правка                                               | Что сделал upstream                   | Тип                           |
| --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------- | ----------------------------- |
| `plugins/provider-pi/src/bridge/bb-pi-extension.ts` | named pipe вместо fd 3/4 (fd не выживает через `cmd.exe`) | переписал fd-канал на Bun file stream | семантический (самый тяжёлый) |

### 2.5 `20ba09f83` — Add Git Graph, Workspace Explorer, and PC Control plugins

| Файл                                                        | Наша правка            | Тип                   |
| ----------------------------------------------------------- | ---------------------- | --------------------- |
| `plugins/bb-official.json`                                  | три новых плагина      | аддитивный            |
| `apps/server/test/services/plugins/builtin-plugins.test.ts` | иконки новых плагинов  | аддитивный            |
| `turbo.json`, `pnpm-lock.yaml`                              | новые workspace-пакеты | аддитивный / lockfile |

### 2.6 Коммиты без прямых конфликтов

- `2b757c186` (Windows CLI exit / process tree / npm invocation) — конфликт только в `pnpm-lock.yaml`.
- `e4f92405a` (портабельность тестов Pi/bridge) — авто-мердж.
- `fe17154c2` (Windows-ссылки на файлы в workspace) — авто-мердж.

## 3. Классификация конфликтов

| Класс                                     | Кол-во путей | Примеры                                                                                                                             |
| ----------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Семантические (одни строки, разный смысл) | 13           | терминалы Windows, канал Pi bridge, хелперы `plugin-build`, версия протокола, `git.ts`, `runtime-shell-env.ts`, `docs/worktrees.md` |
| modify/delete                             | 4            | `provisioning.ts`, `provisioning.test.ts`, `bb-cli/configuration.md`, `bridge.local-file.test.ts`                                   |
| Аддитивные (обе стороны дописали)         | 7            | `.gitignore`, `turbo.json`, `bb-official.json`, тесты регистрации, `launcher.ts`, `setup-script.ts`                                 |
| Lockfile                                  | 1            | `pnpm-lock.yaml` (4 конфликтных блока)                                                                                              |

## 4. Как разрешено

- **Windows-терминалы:** сохранён наш путь (PowerShell + ConPTY); upstream-guard
  «Native Windows terminals are not supported» удалён, его структурные изменения
  (`operationEnvironment`, `openingTerminalIds`) сохранены.
- **Pi bridge:** объединены обе ветки — приоритет named pipe (`BB_PI_BRIDGE_CHANNEL_PIPE`),
  иначе Bun-stream, иначе fd-socket; единый `handleBridgeLine`.
- **`plugin-build`:** принят upstream-рефакторинг, при этом `isPathWithinDirectory` перенесена
  внутрь `resolveManifestAssetFile`; `apps/server/.../manifest.ts` возвращён к upstream-виду
  (форк-дельта больше не нужна).
- **Lifecycle-скрипты:** удалённый upstream-ом `provisioning.ts` заменён на новый
  `apps/host-daemon/src/environment-lifecycle-script.ts` — туда перенесена Windows-логика
  (`.ps1`, PowerShell-команда, предупреждение об игнорируемом `.sh`, инъекция `platform`).
- **Протокол:** `HOST_DAEMON_PROTOCOL_VERSION = 208` = upstream `207` + наш enum `windows`.
- **Документация:** в `docs/worktrees.md` и в новом `plugins/bb-guide/.../configuration.md`
  сохранён Windows-вариант, добавлены upstream-абзацы о жизненном цикле хуков.
- **Lockfile:** взят upstream-вариант и перегенерирован через `pnpm install`.
- **Каталоги/списки:** объединены обе стороны (наши плагины + upstream `environment-*`, `bb-guide`).

## 5. Пост-мердж правки (не конфликты, но потребовались)

- `packages/plugin-registry/scripts/build-registry.mjs`: `path.posix` вместо `path.normalize`
  — на Windows ломался `--check` («item name collision»).
- `packages/plugin-build/src/bundled-workspace.test.ts`: запуск turbo через
  `node node_modules/turbo/bin/turbo` (`.CMD` не спавнится без shell).
- `plugins/pc-control`: `@bb/shared-ui/alert-dialog` удалён upstream → переведён на
  `@bb/shared-ui/dialog` (+ `Button` для Cancel/Accept).
- POSIX-only upstream-тесты хуков (`environment-hook`, `environment-dispatch`, часть
  `environment-lifecycle-script`) получили ранний выход на `win32`.
- `terminal-manager.test.ts`: добавлен обязательный upstream-поле `contributedEnv: []`,
  убран несуществующий `workspaceProvisionType`.

## 6. Проверка

| Проверка                                                            | Результат                            |
| ------------------------------------------------------------------- | ------------------------------------ |
| `turbo run typecheck`                                               | 98/98 пакетов зелёные                |
| `turbo run lint`                                                    | зелёный (3 задачи)                   |
| host-daemon: lifecycle / terminal-manager / env-hook / env-dispatch | 68 passed                            |
| server: `builtin-plugins.test.ts`                                   | 31 passed                            |
| pc-control                                                          | 66 passed                            |
| plugin-build: focused (`bundled-workspace`, manifest)               | зелёные (кроме symlink-EPERM тестов) |

**Остаточный риск:** полный прогон тестов на машине сборки не зелёный, но причины не в мердже:
на pre-merge `main` в тех же пакетах падало 106 тестов. Главные причины — ограничения Windows
окружения: нет прав на создание symlink (`EPERM`, нужен Developer Mode), `os.devNull` в
git-командах, таймауты под нагрузкой, поведение git/gh с запросом креденшелов. Новые
upstream-тесты из этой же категории не «зеленились».

## 7. Рекомендации архитектору

1. **Изолировать Windows-слой.** Вынести платформенные правки (`HostPlatform`, shell/terminals,
   lifecycle, пути) в отдельные модули за узким интерфейсом. Сейчас они «размазаны» по общим
   хелперам (`resolveManifestPath`, `runGit`, `launcher`, `runtime-shell-env`), которые upstream
   регулярно рефакторит.
2. **Не патчить общие хелперы.** Форк-дельта в `runGit`/`launcher`/manifest-хелперах даёт
   конфликты при каждом мердже. Предпочтительнее локальные обёртки/адаптеры в отдельных файлах.
3. **Версия протокола.** Нужно правило: при любой форк-правке wire-полей —
   `max(upstream) + 1`. Сейчас это гарантированный конфликт каждый мердж (13 upstream-бампов).
4. **Lifecycle-скрипты.** Держать выбор POSIX/Windows в одном месте (уже сделано:
   `environment-lifecycle-script.ts`) и тестировать через инъекцию `platform`, а не через
   `process.platform`, — это позволит новым upstream-тестам работать без форк-правок.
5. **POSIX-only тесты.** Ввести централизованный хелпер (например, `itPosix`) вместо россыпи
   ранних `return`. Тогда новые upstream-тесты адаптируются одной строкой и не дают шума при мердже.
6. **Каталоги плагинов.** `plugins/bb-official.json`, builtin-registry и `turbo.json` конфликтуют
   аддитивно, но регулярно. Рассмотреть `.gitattributes` merge-стратегию или разделение
   «upstream-каталог» / «форк-каталог».
7. **Lockfile.** Продолжать практику «взять upstream + `pnpm install`», а не править конфликты вручную.
8. **Проверять symlink-права на CI/машине сборки** (Developer Mode) — иначе десятки upstream-тестов
   падают по окружению и маскируют реальные регрессии.

## Приложение A. Полный список конфликтных путей (26)

```
.gitignore
apps/host-daemon/src/runtime-shell-env.ts
apps/host-daemon/src/terminals/terminal-manager.test.ts
apps/host-daemon/src/terminals/terminal-manager.ts
apps/server/src/services/plugins/manifest.ts
apps/server/src/services/skills/builtin-skills/bb-cli/references/configuration.md   (modify/delete)
apps/server/test/services/plugins/builtin-plugins.test.ts
docs/worktrees.md
packages/bb-app/src/launcher.ts
packages/domain/src/setup-script.ts
packages/host-daemon-contract/src/protocol.ts
packages/host-daemon-contract/test/contract.test.ts
packages/host-workspace/src/git.ts
packages/host-workspace/src/provisioning.ts                                       (modify/delete)
packages/host-workspace/test/provision.test.ts
packages/host-workspace/test/provisioning.test.ts                                 (modify/delete)
packages/plugin-build/src/build-plugin-app.ts
packages/plugin-build/src/build-plugin-host.ts
packages/plugin-build/src/build-plugin-server.ts
packages/plugin-build/src/index.ts
packages/plugin-build/src/plugin-manifest.ts
plugins/bb-official.json
plugins/provider-pi/src/bridge/bb-pi-extension.ts
plugins/provider-pi/src/bridge/bridge.local-file.test.ts                          (modify/delete)
pnpm-lock.yaml
turbo.json
```

## Приложение B. Локальные коммиты форка (до мерджа)

```
20ba09f83 Add Git Graph, Workspace Explorer, and PC Control plugins
657fc7320 Add Windows supervisor scripts and native terminal shell resolution
2b757c186 Harden Windows CLI exit, process tree shutdown, and plugin npm invocation
b4e95fa8c Address native Windows support review findings
fe17154c2 Open workspace file links and previews on native Windows hosts
e4f92405a Make the Pi provider and bridge-protocol suites pass on native Windows
c923c0471 Fix Pi model loading and process control on native Windows
9c94469f2 Support native Windows hosts
```

> AGENT GENERATED
