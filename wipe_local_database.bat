@echo off
setlocal EnableExtensions

rem Permanently resets only the local tabletop companion database.
set "APP_DIR=%~dp0"
set "PYTHON_EXE=%APP_DIR%.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo ERROR: Python virtual environment not found:
    echo   %PYTHON_EXE%
    exit /b 1
)

pushd "%APP_DIR%"
"%PYTHON_EXE%" wipe_local_database.py
set "WIPE_EXIT=%ERRORLEVEL%"
popd
exit /b %WIPE_EXIT%
