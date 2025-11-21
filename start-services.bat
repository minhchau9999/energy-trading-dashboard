@echo off
REM Energy Trading Dashboard - Simple Service Manager
REM Usage: start-services.bat [start|stop|restart|status]

setlocal enabledelayedexpansion
set "ACTION=%1"
if "%ACTION%"=="" set "ACTION=start"

echo.
echo ================================
echo Energy Trading Dashboard Manager
echo ================================
echo.

REM Colors (if supported)
for /F %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"
set "GREEN=%ESC%[32m"
set "RED=%ESC%[31m"
set "YELLOW=%ESC%[33m"
set "BLUE=%ESC%[34m"
set "RESET=%ESC%[0m"

goto %ACTION% 2>nul || goto usage

:start
echo %BLUE%Starting Energy Trading Dashboard services...%RESET%
echo.

REM Start TimescaleDB
echo %BLUE%1. Starting TimescaleDB...%RESET%
podman start timescaledb >nul 2>&1
if errorlevel 1 (
    echo %RED%❌ Failed to start TimescaleDB. Make sure container exists:%RESET%
    echo %YELLOW%   podman run -d --name timescaledb -p 5433:5432 -e POSTGRES_PASSWORD=password docker.io/timescale/timescaledb:latest-pg15%RESET%
    goto end
) else (
    echo %GREEN%✅ TimescaleDB started%RESET%
)

REM Wait for database to be ready
echo %YELLOW%   Waiting for database to be ready...%RESET%
timeout /t 5 >nul

REM Kill any existing node processes first
taskkill /f /im node.exe >nul 2>&1

REM Start Dashboard Server
echo %BLUE%2. Starting Dashboard Server...%RESET%
echo %YELLOW%   Please wait, this may take 30-60 seconds...%RESET%
start "Energy Trading Dashboard" /min cmd /c "cd /d %~dp0 && set NODE_TLS_REJECT_UNAUTHORIZED=0 && node server.js > server.log 2>&1"

REM Wait and check for server startup with retry logic
set /a attempts=0
set /a max_attempts=30

:check_server
set /a attempts+=1
timeout /t 2 >nul

REM Check if port 3000 is listening
netstat -an | find ":3000" | find "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo %GREEN%✅ Dashboard server started successfully%RESET%
    echo %BLUE%   🌐 Available at: http://localhost:3000%RESET%
    goto server_ready
)

REM Check if node process is running
tasklist | find "node.exe" >nul 2>&1
if errorlevel 1 (
    echo %RED%❌ Dashboard server failed to start%RESET%
    echo %YELLOW%   Check server.log for errors%RESET%
    goto end
)

if %attempts% lss %max_attempts% (
    echo %YELLOW%   Waiting for server... [%attempts%/%max_attempts%]%RESET%
    goto check_server
)

echo %RED%❌ Dashboard server did not start within expected time%RESET%
echo %YELLOW%   Check server.log for details%RESET%
goto end

:server_ready
echo.
echo %GREEN%🎉 All services started successfully!%RESET%
echo.
echo %YELLOW%Service Status:%RESET%
echo %GREEN%   ✅ TimescaleDB: Running on localhost:5433%RESET%
echo %GREEN%   ✅ Dashboard: Running on http://localhost:3000%RESET%
echo.
echo %BLUE%📝 Logs:%RESET%
echo %YELLOW%   Server logs: server.log%RESET%
echo.
echo %BLUE%💡 Next steps:%RESET%
echo %YELLOW%   1. Open http://localhost:3000 in your browser%RESET%
echo %YELLOW%   2. Check server.log if you encounter any issues%RESET%
echo %YELLOW%   3. Use 'start-services.bat stop' to stop all services%RESET%
echo.
goto end

:stop
echo %BLUE%Stopping Energy Trading Dashboard services...%RESET%
echo.

REM Stop Node.js processes
echo %BLUE%1. Stopping Dashboard Server...%RESET%
tasklist | find "node.exe" >nul 2>&1
if not errorlevel 1 (
    taskkill /f /im node.exe >nul 2>&1
    echo %GREEN%✅ Dashboard server stopped%RESET%
) else (
    echo %YELLOW%ℹ️ Dashboard server was not running%RESET%
)

REM Stop TimescaleDB
echo %BLUE%2. Stopping TimescaleDB...%RESET%
podman stop timescaledb >nul 2>&1
if errorlevel 1 (
    echo %YELLOW%ℹ️ TimescaleDB was not running%RESET%
) else (
    echo %GREEN%✅ TimescaleDB stopped%RESET%
)

echo.
echo %GREEN%🛑 All services stopped!%RESET%
goto end

:restart
echo %BLUE%Restarting services...%RESET%
call %0 stop
timeout /t 2 >nul
call %0 start
goto end

:status
echo %BLUE%Service Status:%RESET%
echo.

REM Check TimescaleDB
podman ps | find "timescaledb" >nul 2>&1
if errorlevel 1 (
    echo %RED%🗄️ TimescaleDB: ❌ Stopped%RESET%
) else (
    echo %GREEN%🗄️ TimescaleDB: ✅ Running (Port: 5433)%RESET%
)

REM Check Dashboard
netstat -an | find "3000" >nul 2>&1
if errorlevel 1 (
    echo %RED%🌐 Dashboard: ❌ Stopped%RESET%
) else (
    echo %GREEN%🌐 Dashboard: ✅ Running (Port: 3000)%RESET%
    echo %BLUE%   🌐 URL: http://localhost:3000%RESET%
)

REM Check Node processes
set nodecount=0
for /f %%i in ('tasklist ^| find /c "node.exe"') do set nodecount=%%i
if !nodecount! gtr 0 (
    echo %YELLOW%📊 Node.js processes: !nodecount! running%RESET%
) else (
    echo %YELLOW%📊 Node.js processes: None%RESET%
)
goto end

:streaming
echo %BLUE%Starting Streaming Data Ingestion...%RESET%
start "Streaming Ingestion" cmd /c "cd /d %~dp0 && node simpleStreamingDemo.js && pause"
echo %GREEN%✅ Streaming ingestion started in new window%RESET%
echo %BLUE%   Monitor the dashboard to see new records being added%RESET%
goto end

:usage
echo Usage: %0 [start^|stop^|restart^|status^|streaming]
echo.
echo Commands:
echo   start     - Start TimescaleDB and Dashboard Server
echo   stop      - Stop all services
echo   restart   - Restart all services
echo   status    - Show service status
echo   streaming - Start streaming data ingestion
echo.
echo Examples:
echo   %0 start
echo   %0 status
echo   %0 streaming

:end
echo.