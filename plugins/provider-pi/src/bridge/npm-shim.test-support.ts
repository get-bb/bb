export function npmNodeShim(
  cliPath: string,
  template: "modern" | "legacy" = "modern",
): string {
  const lines =
    template === "legacy"
      ? [
          '@IF EXIST "%~dp0\\node.exe" (',
          '  "%~dp0\\node.exe"  "%~dp0\\' + cliPath + '" %*',
          ") ELSE (",
          "  @SETLOCAL",
          "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
          '  node  "%~dp0\\' + cliPath + '" %*',
          ")",
          "",
        ]
      : [
          "@ECHO off",
          "GOTO start",
          ":find_dp0",
          "SET dp0=%~dp0",
          "EXIT /b",
          ":start",
          "SETLOCAL",
          "CALL :find_dp0",
          "",
          'IF EXIST "%dp0%\\node.exe" (',
          '  SET "_prog=%dp0%\\node.exe"',
          ") ELSE (",
          '  SET "_prog=node"',
          "  SET PATHEXT=%PATHEXT:;.JS;=;%",
          ")",
          "",
          'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\' +
            cliPath +
            '" %*',
          "",
        ];
  return lines.join("\r\n");
}
