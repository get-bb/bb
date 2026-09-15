# Change Log: панель истории изменений треда

## Goal

Дать пользователю компактную **историю правок файлов в одном месте** — вкладка
**Changes** (`Clock`) в правой панели треда, без прокрутки всего чата.
Встроенная вкладка Diff показывает только итоговое состояние рабочей копии;
здесь — хронология правок по ходам.

Status (implemented): плагин `plugins/change-log` реализован, тесты и
typecheck проходят.

## Request

Verbatim: «А можно спроектировать extension, или найти готовый, чтобы в правой
панели выводились только изменения? Чтобы не надо было проматывать весь чат, а
можно было историю изменений посмотреть компактно в одном месте?»

## Decisions (final)

1. **Вкладка** — `threadPanelAction` с `title: "Changes"`, `icon: "Clock"`,
   `layout: "flush"`.
2. **Метки времени** — абсолютное `HH:MM`, относительное («5 мин назад») и
   длительность хода; живые значения обновляются тикером раз в минуту.
3. **`defaultEnabled: false`** — форковый builtin, включается пользователем
   (`bb plugin enable change-log`).
4. **Группировка** — переключатель `By turn / By file`, по умолчанию `By turn`.
5. **Дочерние треды** — переключатель «Child threads», по умолчанию включён;
   записи детей помечены бейджем `child`.
6. **Патчи** — целиком в ответе `listChanges` (страница таймлайна ограничена),
   с лимитом 200 000 символов на патч и флагом `patchTruncated`. Отдельного
   `readPatch` нет.
7. **`messageAction` «Changes in this turn»** — не входит в v1.

## Current State (research)

- Готового плагина нет: `git-history` и форковый `git-graph` — про коммиты;
  `project-explorer`, `filetree`, `files-editor`, `vcs-widget` — про текущее
  дерево/статус; `prompt-log` — та же UX-форма панели, но про промпты.
- Встроенные Diff-вкладка и баннер над composer показывают **итог**, а не
  историю; инлайн-диффы таймлайна (`TimelineFileDiffBlock`) — по одной строке.
- Plugin API закрывает задачу штатно: `app.slots.threadPanelAction`,
  `bb.sdk.threads.timeline`, `experimental_Diff`, `bb.events` + `bb.realtime`,
  `bb.cli.register`.

## Data flow

```
app (panel)                       server (plugin)
-----------                       ---------------
mount / realtime signal  ──RPC──▶ listChanges({ threadId, beforeAnchorSeq?, beforeAnchorId? })
                                  ├─ bb.sdk.threads.get
                                  ├─ bb.sdk.threads.timeline({ includeNestedRows: "true", beforeAnchor* })
                                  ├─ bb.sdk.threads.promptHistory({ limit: "100" })
                                  └─ buildChangeLog → entries/turns/files/totals/page/truncated
раскрытие строки                  рендер experimental_Diff на клиенте
```

- Страница ограничена самим таймлайном; `timelinePage.hasOlderRows` и
  `timelinePage.olderCursor` управляют кнопкой **Load older changes**.
- При догрузке старых страниц записи объединяются по `rowId`, ходы — по
  `turnId`.
- Realtime: сервер публикует `{ threadId }` в канал `change-log` на
  `experimental_thread.events` (коалесцируется ядром ~1/с); клиент фильтрует по
  своему треду, догоняет состояние при reconnect и раз в 20 c, пока вкладка
  видима.
- `nestedThreadId` заполняется, когда `row.threadId` отличается от корневого, —
  это и есть признак правки дочернего треда.

## Implementation

```
plugins/change-log/
  package.json            # bb: server+app, icon Clock, scripts build/prepare:bundled/typecheck/test
  app.tsx                 # definePluginApp → app.slots.threadPanelAction
  server.ts               # bb.rpc, bb.events → bb.realtime, bb.cli
  shared/contract.ts      # zod-контракт listChanges, лимиты
  shared/change-action.ts # created/edited/deleted/renamed + подписи, иконки
  server/timeline-types.ts# типы, выведенные из bb.sdk
  server/collect.ts       # рекурсивный сбор file-change по turn.children и delegation.childRows
  server/build.ts         # entry-маппинг, агрегация файлов/итогов, ходы, промпты, усечение
  server/cli.ts           # разбор аргументов и текстовый/JSON вывод
  components/change-log-panel.tsx
  lib/format.ts           # время, относительное время, длительности, усечение пути
  lib/grouping.ts         # фильтр и группировка по ходам/файлам
  README.md
```

Форк-обвязка (односрочные вставки в уже форк-помеченных местах):

| Файл                                                        | Изменение                                   |
| ----------------------------------------------------------- | ------------------------------------------- |
| `plugins/bb-fork.json`                                      | `change-log` в категории `code-and-reviews` |
| `apps/server/src/services/plugins/builtin-registry.fork.ts` | `defaultEnabled: false`                     |
| `packages/bundled-plugins/package.json`                     | `bb-plugin-change-log`                      |
| `turbo.json`                                                | `bb-plugin-change-log#typecheck`            |
| `apps/server/test/services/plugins/builtin-plugins.test.ts` | `["change-log", "Clock"]`                   |

Wire-протокол сервер/демон не меняется; `HOST_DAEMON_PROTOCOL_VERSION` не
трогаем.

## Post-QA fixes

1. **Windows-пути не релятивизовались** (`C:/...` от провайдера против
   `C:\...` корня) → `open file` падал с «Failed to load file».
   Исправлено в корне: `packages/thread-view/src/relativize-workspace-path.fork.ts`
   (fork-owned helper, нормализует слэши и сравнивает Windows-корень без учёта
   регистра), а `build-thread-timeline.ts` оставляет одну строку вызова. Это
   чинит пути и во встроенном таймлайне, и в плагине.
2. **Повторные правки файла выглядели как `+0 −0`** — провайдер (Pi) присылает
   последующие `fileChange` без текста диффа. Последовательные правки одного
   файла в одном ходе теперь схлопываются в одну запись с `edits: N`,
   суммой `+/−` и самым ранним доступным патчем; запись без статистики
   показывает `changed`. Плагин также скрывает `Open file` для абсолютных путей.

3. **Pi не присылал диффы для правок**: мост провайдера знал только одиночные
   `oldText`/`newText`, а Pi шлёт `edits: [{oldText, newText}]`, поэтому в
   таймлайн попадало `{path, kind: "add"}` без текста. Исправлено в
   `plugins/provider-pi/src/delta-translation.ts`: разбор `edits`, а на
   `tool_execution_end` в change подставляется настоящий unified-патч из
   `result.details.patch`. Это чинит и встроенный таймлайн.

## Tests

- `lib/change-action.test.ts` — вывод действия из `kind`/`movePath`/`diff`.
- `lib/grouping.test.ts` — абсолютность пути, фильтр, группировка по ходам/файлам.
- `server/build.test.ts` — сбор вложенных и delegation-строк, дедупликация,
  агрегация файлов и итогов, путь переименования, длительности ходов и
  выдержки промптов, `agent-only` входы, усечение патча, курсор старой страницы,
  потолок числа записей, пустой тред.
- `server.test.ts` — RPC через fake host, проброс курсора, realtime-сигнал, CLI
  (`--path`, `--limit`, `--json`, `--json-patches`, пустой тред, ошибки).
- `components/change-log-panel.test.tsx` — регистрация вкладки, группировка по
  ходам, раскрытие патча, переключение на файлы, фильтр, пустое и ошибочное
  состояния, retry, realtime для своего/чужого треда, «Load older», «Open file»,
  скрытие `Open file` для абсолютного пути.
- `packages/thread-view/test/relativize-workspace-path.fork.test.ts` — Windows и
  POSIX релятивизация.

## Verification

```bash
pnpm exec turbo run typecheck test --filter=bb-plugin-change-log
pnpm exec turbo run prepare:bundled --filter=bb-plugin-change-log
pnpm exec vitest run --config vitest.config.ts test/services/plugins/builtin-plugins.test.ts  # apps/server
pnpm exec turbo run generate:bb-official-marketplace --filter=@bb/server
```

## Non-goals (v1)

- Не заменяем вкладку Diff (итоговое состояние).
- Не показываем коммиты и MR/PR — это `git-graph`, `git-history`, `guided-review`.
- Не пишем свой diff-viewer: используется `experimental_Diff`.
- Нет inline-вставки в ленту чата: `experimental_timelineRenderer` не даёт
  вставлять строки в чужие записи.
- Нет `messageAction` «Changes in this turn» (возможное расширение).
