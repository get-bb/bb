# Как уменьшить стоимость мерджей с upstream

Анализ дельты форка (`git diff upstream/main...HEAD`, 188 файлов, +20 328 / −333)
после мерджа `42e50d7c2`. Дополняет [upstream-merge-report.md](upstream-merge-report.md).

## Главный вывод

~85% дельты (≈17k строк) — **чистые добавления**, которые не конфликтуют никогда:
`plugins/git-graph`, `plugins/pc-control`, `plugins/workspace-explorer`, `scripts/windows/`,
`README.windows.md`, `apps/cli/bin/bb.cmd`, отдельные тест-файлы (`*-windows-pty.test.ts`,
`windows-shim.test.ts`, …). Этот паттерн — правильный, его надо сохранять и расширять.

Вся боль — в ~40 файлах, где форк **патчит общие upstream-файлы**. Они делятся на
шесть повторяющихся классов, для каждого есть системное решение.

## 1. Upstream PRs — единственный рычаг, убирающий конфликты навсегда

Ряд наших правок платформенно-нейтральны и upstream может их принять. Каждый принятый
PR навсегда удаляет источник конфликтов:

| Правка | Почему upstream примет |
| --- | --- |
| `packages/plugin-build/src/plugin-manifest.ts`: `isPathWithinDirectory` вместо `startsWith(rootDir + "/")` | Текущий код сломан на Windows (бэкслеши) — это багфикс |
| `packages/host-workspace/src/git.ts`: `windowsHide: true` (2 места) | No-op на macOS/Linux |
| `packages/process-utils`: `windowsHide` в `spawnPortableProcess` | No-op на POSIX |
| `packages/plugin-registry/scripts/build-registry.mjs`: `path.posix` | Багфикс кроссплатформенности `--check` |
| `packages/plugin-build/src/bundled-workspace.test.ts`: запуск turbo через `node .../bin/turbo` | Тест не работает на Windows вообще |
| `hostPlatformSchema += "windows"` + labels в `MachinesSettingsSection`/`MachineSettingsView` | Подготовка upstream к Windows |
| `apps/cli`: `process.exit` → `process.exitCode` в proxy-ветках | Общепринятая best practice, чинит зависание stdout на Windows |

Это дешевле, чем разрешать одни и те же конфликты каждый мердж.

## 2. Правило «≤5 строк в чужом файле» — вынос форк-кода в fork-owned модули

Самые дорогие конфликты — семантические, где мы встроили десятки строк в тело
upstream-функций. Решение: форк-код живёт в отдельных модулях, в upstream-файле
остаётся только точка вызова.

| Файл | Сейчас | Целевое состояние |
| --- | --- | --- |
| `terminal-manager.ts` | ~100 строк встроено (`resolveWindowsTerminalShell`, `firstExecutableOnPath`, `terminalShellFamily`), **удалён** upstream-поле `platform` из options | Вынести в `terminal-windows-shell.ts`; **вернуть** поле `platform` и ветвиться по `this.platform === "win32"` вместо `process.platform` — удаление upstream API гарантирует конфликт при любом рефакторинге конструктора |
| `plugins/provider-pi/.../rpc-child.ts` | ~130 строк (`planPiChildKill`, `escalateWindowsShellChildKill`, pipe-сервер) | Вынести в `rpc-child.windows.ts`, в `rpc-child.ts` — только импорт и 2–3 точки вызова |
| `packages/process-utils/src/index.ts` | ~100 строк (`terminateWindowsProcessTree`, `stopWindowsProcessTree`) | Вынести в `process-tree-windows.ts`; в `index.ts` — ранние ветки `if (win32)` по 2 строки |
| `bb-pi-extension.ts` | pipe-канал переплетён с выбором fd/Bun-канала | Если бандлинг pi-extension позволяет sibling-модуль — вынести `channel-pipe.js`; если нет, хотя бы сгруппировать в один блок с минимальными точками касания upstream-кода |
| `environment-lifecycle-script.ts` | выбор имён скриптов встроен в `runSetupScript`/`runTeardownScript` | Вынести `resolveLifecycleScriptNames(platform)` в отдельный модуль |

Противоправила, выведенные из мерджа:

- **Не удалять upstream API** (поле `platform` в `TerminalManagerOptions`, константу
  `UNSUPPORTED_NATIVE_WINDOWS_PROJECT_PATH_MESSAGE` в `project-path.ts`). Удаление —
  гарантированный конфликт; расширение рядом обычно авто-мерджится. Deprecated-поле
  дешевле конфликта.
- **Не переписывать upstream-функции — компоновать.** Пример: `markdown-local-file-link.ts`
  переписал `isValidAbsoluteLocalFilePath` целиком. Дешевле было оставить upstream-проверку
  нетронутой и экспортировать `upstreamCheck(value) || windowsCheck(value)`.

## 3. Точки регистрации — аддитивные, но регулярные конфликты

Обе стороны дописывают одни и те же списки → конфликт каждый мердж:

- `apps/server/src/services/plugins/builtin-registry.ts` → вынести наши три записи в
  `builtin-registry.fork.ts` (`FORK_BUILTIN_PLUGINS`), в upstream-файле оставить одну
  строку `...FORK_BUILTIN_PLUGINS` в конце массива.
- `apps/server/test/services/plugins/builtin-plugins.test.ts` → наши ассерты иконок
  перенести в sibling-файл `builtin-plugins.fork.test.ts`, upstream-тест не трогать.
- `plugins/bb-official.json` → завести `plugins/bb-fork.json` и научить потребителя
  каталога мерджить два файла. `merge=union` в `.gitattributes` для JSON не применять —
  при одновременном дописывании хвоста даст невалидный JSON.
- `turbo.json`, `package.json` scripts, `.gitignore` — конфликт тривиальный, оставить
  как есть; включить в ритуал (п. 6).

## 4. Версия протокола — гарантированный конфликт каждый мердж

`HOST_DAEMON_PROTOCOL_VERSION` (13 upstream-бампов за один мердж) и ассерт в
`contract.test.ts` конфликтуют всегда. Решения:

- Ритуал: при разрешении всегда `max(upstream) + 1`, зафиксировать правило в AGENTS.md
  форка и заскриптовать (merge-скрипт из п. 6 может резолвить эти два файла автоматически).
- Включить `git rerere` (`git config rerere.enabled true`) на машине, где делаются
  мерджи, — повторные резолвы одних и тех же конфликтов станут автоматическими.

## 5. Документация — минимизировать правки upstream-абзацев

`docs/worktrees.md` и `packages/templates/src/templates/bb-guide-environments.md`
содержат прямые противоречия («POSIX only» vs «Windows поддерживается») и переписанные
абзацы — конфликт при любом upstream-редактировании этих мест. Целевой вид:

- upstream-абзацы не трогаем, Windows-специфику выносим в отдельный подраздел
  «### Native Windows» в конце секции (аппенд конфликтует реже, чем правка середины
  абзаца) либо в fork-owned страницу (`docs/windows.md`) + одна строка-ссылка.
- `bb-guide-environments.md` — исключение: это скилл для агента, точность важна,
  но и тут лучше аппенд-секция, чем переплетённые правки.

## 6. Ритуал мерджа (runbook + скрипт)

Зафиксировать `scripts/windows/merge-upstream.ps1` + раздел в форк-AGENTS.md:

1. `git fetch upstream && git merge upstream/main`
2. Авто-резолв известных файлов: `protocol.ts` + `contract.test.ts` → `max+1`;
   `pnpm-lock.yaml` → `git checkout --theirs` + `pnpm install` (уже сложившаяся практика).
3. Мерджить **чаще**: 228 коммитов за раз — главная причина 26 конфликтов.
   Еженедельный мердж держит конфликты в пределах 2–5 путей.
4. CI/локальный отчёт `git diff upstream/main...HEAD --stat` — следить, что дельта
   в upstream-файлах со временем уменьшается (метрика: число патченых upstream-файлов,
   сейчас ~40, цель < 15 после пп. 1–2).

## 7. Тесты — что уже хорошо и что докрутить

Уже правильно: fork-assertions в отдельных `*.windows.test.ts` / `*-pty.test.ts`
файлах — не конфликтуют. Инъекция `platform` в `environment-lifecycle-script.ts`
(вместо `process.platform`) — образец для остальных.

Докрутить:

- Ранние `if (process.platform === "win32") return;` в **телах** upstream-тестов
  (`environment-lifecycle-script.test.ts`, `environment-hook.test.ts`,
  `environment-dispatch.test.ts`) конфликтуют, когда upstream правит тот же тест.
  Заменить на `describe.skipIf(isWindows)` / `it.skipIf(isWindows)` на строке
  объявления — конфликт только при переименовании теста, а не при любой правке тела.
- Завести `test/platform.ts` с `isWindows`/`itPosix` в пакетах, где таких пропусков
  больше двух.

## Приоритеты

1. **Upstream PRs (п. 1)** — максимальный эффект на единицу усилий.
2. **Вынос Windows-кода из `terminal-manager.ts` и `rpc-child.ts`** (п. 2) — эти два
   файла дали самые тяжёлые семантические конфликты и оба активно развиваются upstream.
3. **Fork-реестры** (п. 3) — дёшево, убирает регулярный шум.
4. **Ритуал + частые мерджи** (п. 6) — снижает стоимость всего остального.

> AGENT GENERATED

## Статус реализации (обновление)

Реализовано без upstream PRs (п. 1 отклонён):

- **п. 2 — вынос форк-кода** (правило «наши файлы / конец чужого файла», ≤5 строк,
  маркер-комментарии `bb-fork(...)`):
  - `terminal-windows-shell.ts`, `windows-lifecycle-script.ts`, `skill-entry-file-mode.ts`
    (host-daemon), `rpc-child.windows.ts` (provider-pi), `process-tree-windows.ts`
    (process-utils), `windows-bb-cli-shim.ts` (bb-app), `npm-exec.ts` (cli),
    `install-sources-windows.ts` (server), `project-path-windows.ts` (domain),
    `builtin-registry.fork.ts` (server);
  - восстановлены удалявшиеся upstream-элементы: поле `platform` в
    `TerminalManagerOptions`, константа `UNSUPPORTED_NATIVE_WINDOWS_PROJECT_PATH_MESSAGE`;
  - `bb-pi-extension.ts` остаётся single-file (String.raw-шаблон расширения), форк-код
    сгруппирован и помечен.
- **п. 3 — fork-реестры**: `plugins/bb-fork.json` + мердж в генераторе маркетплейса
  (`fork-catalog-fields.ts`), `plugins/bb-official.json` снова идентичен upstream;
  `FORK_BUILTIN_PLUGINS`; ассерты иконок помечены.
- **п. 4 — ритуал мерджа**: `scripts/windows/merge-upstream.ps1` (+ `pnpm run merge:upstream`),
  авто-резолв протокола `max(upstream)+1` и lockfile, `plugins/bb-official.json` — pristine;
  включён `git config rerere.enabled true`.
- **п. 5 — атомарная документация**: `docs/platform-support.md`, `docs/worktrees.md`,
  `docs/configuration.md`, `README.md`, `bb-guide-environments.md` возвращены к upstream
  тексту + одна строка-ссылка; создан форк-хаб `docs/windows.md`.
- **Пояснение по тестам (п. 7 исходного анализа)**: `skipIf` на строке объявления
  переиндентирует тело теста и раздувает дифф (гит-конфликтность выше), поэтому для
  вставленных в upstream-тесты POSIX-проверок оставлены компактные ранние guard'ы, а
  чисто аддитивные windows-тесты вынесены в sibling-файлы
  (`terminal-windows-shell.test.ts`, `windows-lifecycle-script.test.ts`,
  `*.windows.test.ts`).
- **Правило линтера**: `scripts/lib/semantic-comment.mjs` разрешает комментарии-маркеры
  `bb-fork(...)` как санкционированное исключение из `bb(no-comments)`.

### Проверка

| Проверка                | Результат                                                                 |
| ----------------------- | ------------------------------------------------------------------------- |
| `turbo run typecheck`   | 98/98 зелёные                                                             |
| Патченые upstream-файлы | 79 M-файлов (было ~84), существенных вставок в чужой код — единицы строк   |
| host-daemon             | terminals (36 + 2 skip), lifecycle (12) — зелёные                         |
| apps/app windows-тесты  | 16 зелёных                                                                |
| @bb/process-utils, @bb/domain | зелёные                                                             |
| server                  | builtin-plugins + генератор маркетплейса — 37 зелёных                     |
| provider-pi             | 163 passed; 1 env-фейл (EBUSY rmdir)                                      |
| cli                     | 596 passed; 5 env-фейлов (symlink EPERM, NTFS mode bits)                  |

Оставшиеся падения — из известного списка ограничений Windows-окружения
(symlink без Developer Mode, NTFS mode bits, npm/git credential behavior).

> AGENT GENERATED
