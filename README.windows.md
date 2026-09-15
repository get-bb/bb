# bb для Windows

Нативный запуск bb на Windows x64 без WSL: веб-интерфейс, сервер и host-daemon под управлением PowerShell-супервизора.

## Установка

Нужны Git, PowerShell 7 и Node.js 22.19 или новее; pnpm — закреплённая в репозитории версия. Команды выполняются в PowerShell 7:

```powershell
npm install --global pnpm@9.15.0
git clone https://github.com/pZayash/bb.git bb
cd bb
pwsh -NoProfile -File scripts/windows/check.ps1
pwsh -NoProfile -File scripts/windows/install.ps1
```

Собирайте остановленный экземпляр: `install.ps1` отказывается собирать, пока из этого каталога запущен bb.

## Запуск, остановка и порты

```powershell
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Status
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Stop
```

После запуска откройте **http://127.0.0.1:38886**. Порт host-daemon — **38887**. Нестандартные порты задаются параметрами `-ServerPort` и `-DaemonPort`.

Launcher работает скрыто. Именованный Windows mutex предотвращает повторный запуск supervisor для одного каталога данных. bb восстанавливает сервер и daemon после завершения их процессов; внешний supervisor перезапускает упавший runtime. Windows Job Object удерживает дочерние процессы в одной группе. Остановка сначала штатная; через 20 секунд оставшиеся процессы группы завершаются принудительно.

Логи и база по умолчанию находятся в `%LOCALAPPDATA%\BBWindows`, вне репозитория. При `Start`, `Stop`, `Status`, установке и обновлении указывайте один и тот же `-DataDir` (или задайте `BB_WINDOWS_DATA_DIR`).

Доступ по умолчанию разрешён только с локального компьютера. Параметр `-Lan` открывает сервер на всех IPv4-интерфейсах, но не настраивает авторизацию, TLS или брандмауэр — настройте защиту отдельно до включения LAN.

Дополнительные переменные окружения можно передать через `-EnvFile <путь>` (формат `.env`; храните файл с секретами вне Git).

## Командная строка bb

Управление службами выполняется через `bb.ps1`. Для команд bb используйте собранный CLI:

```powershell
& .\apps\host-daemon\dist\bb.cmd --help
$env:PATH = (Join-Path $PWD 'apps/host-daemon/dist') + ';' + $env:PATH
bb status --json
```

При нестандартных портах задайте адреса и для CLI в текущем окне PowerShell:

```powershell
$env:BB_SERVER_URL = 'http://127.0.0.1:48886'
$env:BB_HOST_DAEMON_PORT = '48887'
bb status --json
```

## Провайдеры и авторизация

Каждый пользователь самостоятельно авторизует свои провайдеры (Codex, Claude Code и другие). Проверка зависимостей показывает наличие команд в PATH, но не авторизацию:

```powershell
pwsh -NoProfile -File scripts/windows/check.ps1 -Providers
bb provider list --json
```

## Обновление

```powershell
pwsh -NoProfile -File scripts/windows/update.ps1 -Remote origin -Branch main
pwsh -NoProfile -File scripts/windows/bb.ps1 -Action Start
```

Обновление требует чистый Git checkout, выполняет fast-forward, останавливает экземпляр и пересобирает его.

## Разработка из исходников

Для быстрой итерации используйте dev-инстанс, а не собранный:

```powershell
pnpm dev
```

`pnpm dev` печатает URL приложения (Vite с HMR), сервера, порт host-daemon и каталог данных. Порты и каталог данных выводятся из пути checkout, поэтому у каждого worktree они свои и с supervisor-экземпляром на 38886/38887 они не конфликтуют. Server и host-daemon при этом запускаются из исходников через `tsx`, без сборки.

Правки интерфейса подхватываются по HMR, перезапуск не нужен. После правок сервера или host-daemon перезапустите только нужный сервис:

```powershell
pnpm dev:restart-server
pnpm dev:restart-host-daemon
pnpm dev:restart
```

Каждая команда пересобирает при необходимости и перезапускает только затронутый сервис. `dev:restart-server` сам перезапускает и host-daemon, если у запущенного демона другая версия протокола. На Windows запрос на перезапуск идёт через файл `<каталог данных>\dev-supervisors\<сервис>.restart` (в Windows нет `SIGUSR1`); POSIX-путь не меняется.

Состояние и остановка тоже работают на Windows:

```powershell
pnpm dev:status
pnpm dev:stop
```

`pnpm dev:status` печатает каталог данных, URL, pid супервизоров и какие порты слушают. `pnpm dev:stop` штатно останавливает оба супервизора через stop-файлы, затем убирает оставшееся дерево `pnpm dev` — порты и pid-файлы освобождаются. Апстрим убрал `scripts/bb-dev-app` и `pnpm dev:desktop` (#3669), поэтому лаунчер на всех платформах ходит в нативный dev instance control; Ctrl+C в окне `pnpm dev` работает как раньше.

Подробности и ограничения — в [docs/windows.md](docs/windows.md).

## Проверка жизненного цикла

Изолированный смоук-тест (порты 49886/49887, временный каталог данных) проверяет защиту от параллельного запуска, восстановление после падения server/daemon и runtime, остановку и повторный запуск:

```powershell
pnpm run test:windows:lifecycle
```
