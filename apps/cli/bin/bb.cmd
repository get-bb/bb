@echo off
setlocal
if exist "%~dp0daemon-bundle.mjs" goto packaged
if exist "%~dp0bb-chunks\" goto packaged
set "CLI_ENTRY=%~dp0..\dist\index.js"

if not exist "%CLI_ENTRY%" (
  set "REPO_ROOT=%~dp0..\..\.."
  where corepack >nul 2>nul
  if errorlevel 1 (
    echo Missing built bb CLI entry at "%CLI_ENTRY%" and corepack is not available to build it. 1>&2
    exit /b 1
  )
  call corepack pnpm -C "%REPO_ROOT%" run --silent cli:prepare 1>&2
  if errorlevel 1 exit /b 1
)

goto run

:packaged
set "CLI_ENTRY=%~dp0bb"
if not exist "%CLI_ENTRY%" (
  echo Missing packaged bb CLI entry at "%CLI_ENTRY%". Reinstall or rebuild the host package. 1>&2
  exit /b 1
)

:run
node "%CLI_ENTRY%" %*
exit /b %errorlevel%
