@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "CLI_ENTRY=%SCRIPT_DIR%..\dist\index.js"
if not exist "%CLI_ENTRY%" (
  echo Missing built bb CLI entry at %CLI_ENTRY%. Run pnpm cli:prepare first. 1>&2
  exit /b 1
)
node "%CLI_ENTRY%" %*
