@echo off
rem NWEA Research Works - optional local preview using Node.js.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL%==0 goto :node
goto :none

:node
node serve.js
goto :end

:none
echo Could not find Node.js on this machine.
echo Open index.html directly in your browser, or install Node.js.
pause

:end
endlocal
