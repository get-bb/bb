@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
set "CLI_ENTRY=%SCRIPT_DIR%..\dist\index.js"
if not exist "%CLI_ENTRY%" (
  echo Missing built bb CLI entry at %CLI_ENTRY%. Run pnpm cli:prepare first. 1>&2
  exit /b 1
)
call :find_node
if not defined NODE_EXE (
  echo node.exe not found on PATH. 1>&2
  exit /b 1
)
"%NODE_EXE%" "%CLI_ENTRY%" %*
exit /b %ERRORLEVEL%

:find_node
setlocal EnableDelayedExpansion
set "NODE_EXE="
for %%D in ("%PATH:;=";"%") do (
  set "ENTRY=%%~D"
  if defined ENTRY if /I not "!ENTRY!"=="." if /I not "!ENTRY:~0,1!"=="." (
    if /I "!ENTRY:~1,1!"==":" (
      if exist "!ENTRY!\node.exe" (
        endlocal & set "NODE_EXE=%%~D\node.exe"
        goto :eof
      )
    ) else if /I "!ENTRY:~0,2!"=="\\" (
      if exist "!ENTRY!\node.exe" (
        endlocal & set "NODE_EXE=%%~D\node.exe"
        goto :eof
      )
    )
  )
)
endlocal
goto :eof
