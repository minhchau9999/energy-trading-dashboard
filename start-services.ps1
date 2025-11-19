#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Energy Trading Dashboard - Service Management Script
.DESCRIPTION
    Manages all services required for the Energy Trading Dashboard:
    - TimescaleDB (Podman container)
    - Dashboard Server (Node.js)
    - Optional: Streaming Data Ingestion
.PARAMETER Action
    The action to perform: start, stop, restart, status
.PARAMETER Services
    Which services to manage: all, database, dashboard, streaming
.EXAMPLE
    .\start-services.ps1 -Action start
    .\start-services.ps1 -Action stop -Services database
    .\start-services.ps1 -Action status
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("all", "database", "dashboard", "streaming")]
    [string]$Services = "all"
)

# Configuration
$CONTAINER_NAME = "timescaledb"
$DASHBOARD_PORT = 3000
$DB_PORT = 5433
$PROJECT_DIR = $PSScriptRoot

# Colors for output
$Green = "`e[32m"
$Red = "`e[31m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

function Write-ColorOutput {
    param($Message, $Color = $Reset)
    Write-Host "$Color$Message$Reset"
}

function Test-ServiceRunning {
    param($ServiceName, $Port)
    
    try {
        $connection = Test-NetConnection -ComputerName localhost -Port $Port -InformationLevel Quiet
        return $connection
    } catch {
        return $false
    }
}

function Test-PodmanContainer {
    param($ContainerName)
    
    try {
        $status = podman ps --filter "name=$ContainerName" --format "{{.Status}}"
        return $status -like "Up*"
    } catch {
        return $false
    }
}

function Start-Database {
    Write-ColorOutput "🗄️  Starting TimescaleDB..." $Blue
    
    # Check if container exists
    $containerExists = podman ps -a --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | Where-Object { $_ -eq $CONTAINER_NAME }
    
    if (-not $containerExists) {
        Write-ColorOutput "❌ TimescaleDB container '$CONTAINER_NAME' not found. Creating it..." $Red
        Write-ColorOutput "   Run this command first:" $Yellow
        Write-ColorOutput "   podman run -d --name $CONTAINER_NAME -p ${DB_PORT}:5432 -e POSTGRES_PASSWORD=password docker.io/timescale/timescaledb:latest-pg15" $Yellow
        return $false
    }
    
    $isRunning = Test-PodmanContainer -ContainerName $CONTAINER_NAME
    
    if ($isRunning) {
        Write-ColorOutput "✅ TimescaleDB is already running" $Green
        return $true
    }
    
    try {
        podman start $CONTAINER_NAME | Out-Null
        Start-Sleep -Seconds 3
        
        $isRunning = Test-PodmanContainer -ContainerName $CONTAINER_NAME
        if ($isRunning) {
            Write-ColorOutput "✅ TimescaleDB started successfully" $Green
            Write-ColorOutput "   📡 Available at: localhost:$DB_PORT" $Blue
            return $true
        } else {
            Write-ColorOutput "❌ Failed to start TimescaleDB" $Red
            return $false
        }
    } catch {
        Write-ColorOutput "❌ Error starting TimescaleDB: $($_.Exception.Message)" $Red
        return $false
    }
}

function Stop-Database {
    Write-ColorOutput "🗄️  Stopping TimescaleDB..." $Blue
    
    $isRunning = Test-PodmanContainer -ContainerName $CONTAINER_NAME
    
    if (-not $isRunning) {
        Write-ColorOutput "✅ TimescaleDB is already stopped" $Green
        return $true
    }
    
    try {
        podman stop $CONTAINER_NAME | Out-Null
        Write-ColorOutput "✅ TimescaleDB stopped successfully" $Green
        return $true
    } catch {
        Write-ColorOutput "❌ Error stopping TimescaleDB: $($_.Exception.Message)" $Red
        return $false
    }
}

function Start-Dashboard {
    Write-ColorOutput "🌐 Starting Dashboard Server..." $Blue
    
    $isDashboardRunning = Test-ServiceRunning -ServiceName "Dashboard" -Port $DASHBOARD_PORT
    
    if ($isDashboardRunning) {
        Write-ColorOutput "✅ Dashboard server is already running" $Green
        return $true
    }
    
    try {
        Push-Location $PROJECT_DIR
        
        # Start the dashboard server in background
        $job = Start-Job -ScriptBlock {
            param($projectDir)
            Set-Location $projectDir
            node server.js
        } -ArgumentList $PROJECT_DIR
        
        Start-Sleep -Seconds 3
        
        $isDashboardRunning = Test-ServiceRunning -ServiceName "Dashboard" -Port $DASHBOARD_PORT
        
        if ($isDashboardRunning) {
            Write-ColorOutput "✅ Dashboard server started successfully" $Green
            Write-ColorOutput "   🌐 Available at: http://localhost:$DASHBOARD_PORT" $Blue
            Write-ColorOutput "   🔧 Job ID: $($job.Id) (use Stop-Job $($job.Id) to stop manually)" $Yellow
            return $true
        } else {
            Write-ColorOutput "❌ Failed to start dashboard server" $Red
            return $false
        }
    } catch {
        Write-ColorOutput "❌ Error starting dashboard: $($_.Exception.Message)" $Red
        return $false
    } finally {
        Pop-Location
    }
}

function Stop-Dashboard {
    Write-ColorOutput "🌐 Stopping Dashboard Server..." $Blue
    
    # Find and stop Node.js processes running server.js
    $nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -eq "node" -and $_.CommandLine -like "*server.js*"
    }
    
    if ($nodeProcesses.Count -eq 0) {
        Write-ColorOutput "✅ Dashboard server is already stopped" $Green
        return $true
    }
    
    try {
        $nodeProcesses | ForEach-Object {
            Stop-Process -Id $_.Id -Force
            Write-ColorOutput "✅ Stopped dashboard process (PID: $($_.Id))" $Green
        }
        
        # Stop any PowerShell jobs running the dashboard
        Get-Job | Where-Object { $_.Command -like "*server.js*" } | Stop-Job
        
        return $true
    } catch {
        Write-ColorOutput "❌ Error stopping dashboard: $($_.Exception.Message)" $Red
        return $false
    }
}

function Start-StreamingIngestion {
    Write-ColorOutput "📡 Starting Streaming Data Ingestion..." $Blue
    Write-ColorOutput "   This will add new records to the database from CSV" $Yellow
    
    try {
        Push-Location $PROJECT_DIR
        
        # Start streaming ingestion in background
        $job = Start-Job -ScriptBlock {
            param($projectDir)
            Set-Location $projectDir
            node simpleStreamingDemo.js
        } -ArgumentList $PROJECT_DIR
        
        Write-ColorOutput "✅ Streaming ingestion started" $Green
        Write-ColorOutput "   🔧 Job ID: $($job.Id)" $Yellow
        Write-ColorOutput "   📊 Monitor the dashboard to see new records being added" $Blue
        return $true
    } catch {
        Write-ColorOutput "❌ Error starting streaming ingestion: $($_.Exception.Message)" $Red
        return $false
    } finally {
        Pop-Location
    }
}

function Stop-StreamingIngestion {
    Write-ColorOutput "📡 Stopping Streaming Data Ingestion..." $Blue
    
    # Stop streaming demo processes
    $streamingProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*simpleStreamingDemo.js*"
    }
    
    if ($streamingProcesses.Count -eq 0) {
        Write-ColorOutput "✅ Streaming ingestion is already stopped" $Green
        return $true
    }
    
    try {
        $streamingProcesses | ForEach-Object {
            Stop-Process -Id $_.Id -Force
            Write-ColorOutput "✅ Stopped streaming process (PID: $($_.Id))" $Green
        }
        
        # Stop PowerShell jobs
        Get-Job | Where-Object { $_.Command -like "*simpleStreamingDemo.js*" } | Stop-Job
        
        return $true
    } catch {
        Write-ColorOutput "❌ Error stopping streaming ingestion: $($_.Exception.Message)" $Red
        return $false
    }
}

function Show-Status {
    Write-ColorOutput "📊 Energy Trading Dashboard - Service Status" $Blue
    Write-ColorOutput "================================================" $Blue
    
    # Database status
    $dbRunning = Test-PodmanContainer -ContainerName $CONTAINER_NAME
    $dbStatus = if ($dbRunning) { "✅ Running" } else { "❌ Stopped" }
    $dbColor = if ($dbRunning) { $Green } else { $Red }
    Write-ColorOutput "🗄️  TimescaleDB: $dbStatus (Port: $DB_PORT)" $dbColor
    
    # Dashboard status
    $dashboardRunning = Test-ServiceRunning -ServiceName "Dashboard" -Port $DASHBOARD_PORT
    $dashboardStatus = if ($dashboardRunning) { "✅ Running" } else { "❌ Stopped" }
    $dashboardColor = if ($dashboardRunning) { $Green } else { $Red }
    Write-ColorOutput "🌐 Dashboard Server: $dashboardStatus (Port: $DASHBOARD_PORT)" $dashboardColor
    
    # Streaming ingestion status
    $streamingProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*simpleStreamingDemo.js*"
    }
    $streamingRunning = $streamingProcesses.Count -gt 0
    $streamingStatus = if ($streamingRunning) { "✅ Running ($($streamingProcesses.Count) process(es))" } else { "❌ Stopped" }
    $streamingColor = if ($streamingRunning) { $Green } else { $Red }
    Write-ColorOutput "📡 Streaming Ingestion: $streamingStatus" $streamingColor
    
    Write-ColorOutput "" $Reset
    
    if ($dashboardRunning) {
        Write-ColorOutput "🌐 Dashboard URL: http://localhost:$DASHBOARD_PORT" $Blue
    }
    
    # Show active jobs
    $activeJobs = Get-Job | Where-Object { $_.State -eq "Running" }
    if ($activeJobs.Count -gt 0) {
        Write-ColorOutput "🔧 Active Background Jobs:" $Yellow
        $activeJobs | ForEach-Object {
            Write-ColorOutput "   Job $($_.Id): $($_.Command)" $Yellow
        }
    }
}

# Main script logic
Write-ColorOutput "🌊 Energy Trading Dashboard - Service Manager" $Blue
Write-ColorOutput "============================================" $Blue

switch ($Action.ToLower()) {
    "start" {
        switch ($Services.ToLower()) {
            "all" {
                Write-ColorOutput "🚀 Starting all services..." $Blue
                $dbSuccess = Start-Database
                if ($dbSuccess) {
                    Start-Sleep -Seconds 2
                    $dashSuccess = Start-Dashboard
                    
                    if ($dbSuccess -and $dashSuccess) {
                        Write-ColorOutput "🎉 All core services started successfully!" $Green
                        Write-ColorOutput "   To start streaming ingestion: .\start-services.ps1 -Action start -Services streaming" $Yellow
                    }
                }
            }
            "database" { Start-Database }
            "dashboard" { Start-Dashboard }
            "streaming" { Start-StreamingIngestion }
        }
    }
    
    "stop" {
        switch ($Services.ToLower()) {
            "all" {
                Write-ColorOutput "🛑 Stopping all services..." $Blue
                Stop-StreamingIngestion
                Stop-Dashboard
                Stop-Database
                
                # Clean up all jobs
                Get-Job | Stop-Job
                Get-Job | Remove-Job -Force
                
                Write-ColorOutput "🎉 All services stopped!" $Green
            }
            "database" { Stop-Database }
            "dashboard" { Stop-Dashboard }
            "streaming" { Stop-StreamingIngestion }
        }
    }
    
    "restart" {
        Write-ColorOutput "🔄 Restarting services..." $Blue
        & $MyInvocation.MyCommand.Path -Action stop -Services $Services
        Start-Sleep -Seconds 2
        & $MyInvocation.MyCommand.Path -Action start -Services $Services
    }
    
    "status" {
        Show-Status
    }
}

Write-ColorOutput "✅ Operation completed!" $Green