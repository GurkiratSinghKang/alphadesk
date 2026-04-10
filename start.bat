@echo off
setlocal

set PYTHON=D:\pinokio\bin\miniconda\envs\alphadesk\python.exe
set NODE=D:\pinokio\bin\miniconda\node.exe
set NPM=D:\pinokio\bin\miniconda\npm.cmd
set PROJECT=D:\exp\alphadesk

echo ============================================
echo   AlphaDesk - Starting all services
echo ============================================
echo.

:: --- 1. Docker (TimescaleDB + Redis) ---
echo [1/4] Starting Docker containers...
docker compose -f "%PROJECT%\docker-compose.yml" up -d timescaledb redis
if %errorlevel% neq 0 (
    echo ERROR: Docker failed. Is Docker Desktop running?
    pause
    exit /b 1
)

:: --- 2. Wait for healthy containers ---
echo [2/4] Waiting for databases...
:wait_db
docker inspect --format="{{.State.Health.Status}}" alphadesk-timescaledb 2>nul | findstr "healthy" >nul
if %errorlevel% neq 0 (
    timeout /t 2 /nobreak >nul
    goto wait_db
)
docker inspect --format="{{.State.Health.Status}}" alphadesk-redis 2>nul | findstr "healthy" >nul
if %errorlevel% neq 0 (
    timeout /t 2 /nobreak >nul
    goto wait_db
)
echo   TimescaleDB: healthy
echo   Redis:       healthy
echo.

:: --- 3. Backend ---
echo [3/4] Starting backend (FastAPI :8000)...
start "AlphaDesk Backend" /min cmd /c "cd /d %PROJECT% && %PYTHON% start_backend.py 2>&1 | tee backend.log"
timeout /t 5 /nobreak >nul

:: --- 4. Frontend ---
echo [4/4] Starting frontend (Next.js :3000)...
set PATH=D:\pinokio\bin\miniconda;%PATH%
start "AlphaDesk Frontend" /min cmd /c "cd /d %PROJECT%\frontend && %NPM% run dev 2>&1 | tee ..\frontend.log"
timeout /t 8 /nobreak >nul

:: --- Done ---
echo.
echo ============================================
echo   AlphaDesk is running!
echo.
echo   Frontend:  http://localhost:3000
echo   Backend:   http://localhost:8000
echo   Database:  localhost:5432
echo   Redis:     localhost:6379
echo.
echo   Close the terminal windows to stop.
echo ============================================
echo.

start http://localhost:3000

endlocal
