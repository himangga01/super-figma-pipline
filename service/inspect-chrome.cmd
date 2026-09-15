@echo off
setlocal
cd /d "%~dp0"
node packages\cli\dist\index.mjs chrome-inspect %*
exit /b %ERRORLEVEL%
