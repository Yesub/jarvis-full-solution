# ============================================================================
# Monitoring Scripts for llama.cpp (node-llama-cpp process)
# Author: Claude
# Usage: Run in PowerShell as Administrator
# ============================================================================

# ============================================================================
# 1. SIMPLE : Vue en temps réel (RAM + CPU) - QUICK START
# ============================================================================

function Get-LlamaCppMemory {
    $processes = Get-Process -Name node -ErrorAction SilentlyContinue
    
    if (-not $processes) {
        Write-Host "ERREUR: Aucun processus 'node' detecte" -ForegroundColor Red
        return
    }

    Write-Host ""
    Write-Host "PROCESSUS NODE.JS (llama.cpp)" -ForegroundColor Cyan
    Write-Host "=============================================================" -ForegroundColor Cyan
    
    $processes | ForEach-Object {
        $ramMB = [math]::Round($_.WorkingSet / 1MB, 2)
        $ramGB = [math]::Round($_.WorkingSet / 1GB, 3)
        $cpu = [math]::Round($_.CPU, 2)
        
        Write-Host "PID: $($_.Id)" -ForegroundColor Yellow
        Write-Host "  RAM: $ramMB MB ($ramGB GB)"
        Write-Host "  CPU: $cpu sec"
        Write-Host "  Threads: $($_.Threads.Count)"
    }
    Write-Host ""
}


# ============================================================================
# 2. MONITORING EN CONTINU (Refresh auto)
# ============================================================================

function Watch-LlamaCppMemory {
    param(
        [int]$IntervalSeconds = 2
    )
    
    $count = 0
    
    while ($true) {
        Clear-Host
        $count++
        Write-Host "MONITORING llama.cpp [Refresh $count] - Intervalle: ${IntervalSeconds}s (Ctrl+C pour arreter)" -ForegroundColor Green
        Write-Host "=============================================================" -ForegroundColor Green
        
        $processes = Get-Process -Name node -ErrorAction SilentlyContinue
        
        if (-not $processes) {
            Write-Host "ERREUR: Processus Node.js non detecte" -ForegroundColor Red
            Write-Host "Appuyez sur Ctrl+C pour quitter"
            Start-Sleep -Seconds $IntervalSeconds
            continue
        }
        
        $totalRamMB = 0
        
        $processes | ForEach-Object {
            $ramMB = [math]::Round($_.WorkingSet / 1MB, 2)
            $ramGB = [math]::Round($_.WorkingSet / 1GB, 3)
            $cpu = [math]::Round($_.CPU, 2)
            $handles = $_.Handles
            
            $totalRamMB += $ramMB
            
            Write-Host ""
            Write-Host "PID: $($_.Id)" -ForegroundColor Yellow
            Write-Host "  RAM       : $ramMB MB ($ramGB GB)" -ForegroundColor Cyan
            Write-Host "  CPU Time  : $cpu sec" -ForegroundColor Cyan
            Write-Host "  Handles   : $handles" -ForegroundColor Cyan
            Write-Host "  Threads   : $($_.Threads.Count)" -ForegroundColor Cyan
            Write-Host "  Name      : $($_.ProcessName)" -ForegroundColor Gray
        }
        
        $systemRamGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 2)
        $usedRamGB = [math]::Round($totalRamMB / 1024, 2)
        $percentUsed = [math]::Round(($totalRamMB / ($systemRamGB * 1024)) * 100, 1)
        
        Write-Host ""
        Write-Host "=============================================================" -ForegroundColor Green
        Write-Host "Total Systeme: $usedRamGB / $systemRamGB GB (${percentUsed}%)" -ForegroundColor Green
        Write-Host ""
        
        Start-Sleep -Seconds $IntervalSeconds
    }
}


# ============================================================================
# 3. DÉTAIL AVANCÉ (RAM virtuelle + privée + pagefile)
# ============================================================================

function Get-LlamaCppDetailedMemory {
    $processes = Get-Process -Name node -ErrorAction SilentlyContinue
    
    if (-not $processes) {
        Write-Host "ERREUR: Aucun processus 'node' detecte" -ForegroundColor Red
        return
    }

    Write-Host ""
    Write-Host "DETAIL MEMOIRE - Processus Node.js (llama.cpp)" -ForegroundColor Cyan
    Write-Host "=============================================================" -ForegroundColor Cyan
    
    $processes | ForEach-Object {
        $workingSetMB = [math]::Round($_.WorkingSet / 1MB, 2)
        $virtualMemMB = [math]::Round($_.VirtualMemorySize / 1MB, 2)
        $peakWorkingSetMB = [math]::Round($_.PeakWorkingSet / 1MB, 2)
        $peakVirtualMemMB = [math]::Round($_.PeakVirtualMemorySize / 1MB, 2)
        
        Write-Host ""
        Write-Host "PID: $($_.Id)" -ForegroundColor Yellow
        Write-Host "  Working Set (RAM physique)    : $workingSetMB MB"
        Write-Host "  Virtual Memory                : $virtualMemMB MB"
        Write-Host "  Peak Working Set              : $peakWorkingSetMB MB"
        Write-Host "  Peak Virtual Memory           : $peakVirtualMemMB MB"
        Write-Host "  Difference (Virtual - Phys)   : $([math]::Round($virtualMemMB - $workingSetMB, 2)) MB"
    }
    Write-Host ""
}


# ============================================================================
# 4. GPU MONITORING (NVIDIA)
# ============================================================================

function Get-LlamaCppGPUUsage {
    Write-Host ""
    Write-Host "GPU USAGE (NVIDIA)" -ForegroundColor Magenta
    Write-Host "=============================================================" -ForegroundColor Magenta
    
    $nvidiaPath = "C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    
    if (Test-Path $nvidiaPath) {
        Write-Host ""
        Write-Host "GPU NVIDIA DETECTE" -ForegroundColor Green
        Write-Host "=============================================================" -ForegroundColor Green
        
        try {
            $nvidiaOutput = & $nvidiaPath --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory --format=csv,noheader,nounits
            
            Write-Host "Index | GPU Name | Total Mem | Used Mem | Free Mem | GPU Load | Mem Load"
            Write-Host "===== | ======== | ========= | ======== | ======== | ======== | ========"
            
            $nvidiaOutput | ForEach-Object {
                Write-Host $_
            }
            
            Write-Host ""
            Write-Host "Processus utilisant le GPU:"
            Write-Host "============================"
            $procOutput = & $nvidiaPath --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits
            $procOutput | ForEach-Object {
                if ($_ -and $_ -ne "") {
                    Write-Host $_
                }
            }
        } catch {
            Write-Host "ERREUR lors de l'execution de nvidia-smi" -ForegroundColor Yellow
        }
    } else {
        Write-Host ""
        Write-Host "ATTENTION: NVIDIA GPU non detecte (nvidia-smi non trouve)" -ForegroundColor Yellow
    }
    
    Write-Host ""
}


# ============================================================================
# 5. DASHBOARD COMPLET (Le meilleur pour tout voir)
# ============================================================================

function Show-LlamaCppDashboard {
    param(
        [int]$IntervalSeconds = 2
    )
    
    $count = 0
    
    while ($true) {
        Clear-Host
        $count++
        $timestamp = Get-Date -Format "HH:mm:ss"
        
        Write-Host "=================================================================" -ForegroundColor Cyan
        Write-Host "LLAMA.CPP MONITORING DASHBOARD" -ForegroundColor Cyan
        Write-Host "$timestamp | Refresh $count | Intervalle: ${IntervalSeconds}s" -ForegroundColor Cyan
        Write-Host "=================================================================" -ForegroundColor Cyan
        
        # ===== RAM =====
        Write-Host ""
        Write-Host "RAM USAGE" -ForegroundColor Green
        Write-Host "=================================================================" -ForegroundColor Green
        
        $processes = Get-Process -Name node -ErrorAction SilentlyContinue
        
        if ($processes) {
            $totalRamMB = 0
            $processes | ForEach-Object {
                $ramMB = [math]::Round($_.WorkingSet / 1MB, 2)
                $ramGB = [math]::Round($_.WorkingSet / 1GB, 3)
                $totalRamMB += $ramMB
                
                Write-Host "  Node.js [PID: $($_.Id)]  : $ramMB MB ($ramGB GB)"
            }
            
            $systemRamGB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 2)
            $usedRamGB = [math]::Round($totalRamMB / 1024, 2)
            $percentUsed = [math]::Round(($totalRamMB / ($systemRamGB * 1024)) * 100, 1)
            
            Write-Host "  ---"
            Write-Host "  Total Systeme: $usedRamGB / $systemRamGB GB (${percentUsed}%)" -ForegroundColor Yellow
        } else {
            Write-Host "  ERREUR: Aucun processus Node.js detecte" -ForegroundColor Red
        }
        
        # ===== GPU =====
        Write-Host ""
        Write-Host "GPU USAGE (NVIDIA)" -ForegroundColor Magenta
        Write-Host "=================================================================" -ForegroundColor Magenta
        
        $nvidiaPath = "C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
        
        if (Test-Path $nvidiaPath) {
            try {
                $gpuMemory = & $nvidiaPath --query-gpu=memory.used,memory.total --format=csv,noheader,nounits
                $gpuUtil = & $nvidiaPath --query-gpu=utilization.gpu --format=csv,noheader,nounits
                
                $parts = $gpuMemory.Split(" ")
                if ($parts.Count -ge 2) {
                    $usedMem = [int]$parts[0]
                    $totalMem = [int]$parts[1]
                    $gpuPercent = [math]::Round(($usedMem / $totalMem) * 100, 1)
                    
                    Write-Host "  Memory: $usedMem MB / $totalMem MB (${gpuPercent}%)" -ForegroundColor Cyan
                    Write-Host "  GPU Load: $([int]$gpuUtil)%" -ForegroundColor Cyan
                }
            } catch {
                Write-Host "  ERREUR nvidia-smi" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ATTENTION: NVIDIA GPU non detecte" -ForegroundColor Gray
        }
        
        # ===== CPU =====
        Write-Host ""
        Write-Host "CPU USAGE" -ForegroundColor Yellow
        Write-Host "=================================================================" -ForegroundColor Yellow
        
        if ($processes) {
            $cpuPercent = [math]::Round((($processes | Measure-Object -Property CPU -Sum).Sum / [Environment]::ProcessorCount) * 2, 1)
            Write-Host "  CPU Load: ${cpuPercent}%" -ForegroundColor Yellow
        }
        
        Write-Host ""
        Write-Host "=================================================================" -ForegroundColor Cyan
        
        Start-Sleep -Seconds $IntervalSeconds
    }
}


# ============================================================================
# 6. EXPORT LOGS (Sauvegarde les données dans un CSV)
# ============================================================================

function Export-LlamaCppMetrics {
    param(
        [string]$OutputPath = "llama-metrics.csv",
        [int]$DurationSeconds = 60
    )
    
    $startTime = Get-Date
    $endTime = $startTime.AddSeconds($DurationSeconds)
    $metrics = @()
    
    Write-Host "Export des metriques en cours (${DurationSeconds} sec) vers: $OutputPath" -ForegroundColor Green
    
    while ((Get-Date) -lt $endTime) {
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $processes = Get-Process -Name node -ErrorAction SilentlyContinue
        
        if ($processes) {
            $processes | ForEach-Object {
                $metric = [PSCustomObject]@{
                    Timestamp = $timestamp
                    PID = $_.Id
                    RamMB = [math]::Round($_.WorkingSet / 1MB, 2)
                    RamGB = [math]::Round($_.WorkingSet / 1GB, 3)
                    CPU = [math]::Round($_.CPU, 2)
                    Threads = $_.Threads.Count
                }
                $metrics += $metric
            }
        }
        
        Start-Sleep -Seconds 1
    }
    
    $metrics | Export-Csv -Path $OutputPath -NoTypeInformation
    Write-Host "Export termine: $OutputPath" -ForegroundColor Green
    Write-Host "Lignes enregistrees: $($metrics.Count)" -ForegroundColor Green
}


# ============================================================================
# QUICK REFERENCE
# ============================================================================

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "LLAMA.CPP MONITORING - QUICK REFERENCE" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. AFFICHAGE SIMPLE (une fois):" -ForegroundColor Yellow
Write-Host "   Get-LlamaCppMemory" -ForegroundColor White
Write-Host ""
Write-Host "2. MONITORING EN CONTINU (Ctrl+C pour arreter):" -ForegroundColor Yellow
Write-Host "   Watch-LlamaCppMemory -IntervalSeconds 2" -ForegroundColor White
Write-Host ""
Write-Host "3. DETAIL MEMOIRE (Virtual + Private + Peak):" -ForegroundColor Yellow
Write-Host "   Get-LlamaCppDetailedMemory" -ForegroundColor White
Write-Host ""
Write-Host "4. GPU USAGE (NVIDIA):" -ForegroundColor Yellow
Write-Host "   Get-LlamaCppGPUUsage" -ForegroundColor White
Write-Host ""
Write-Host "5. DASHBOARD COMPLET (RAM + GPU + CPU) - RECOMMANDE:" -ForegroundColor Yellow
Write-Host "   Show-LlamaCppDashboard -IntervalSeconds 1" -ForegroundColor White
Write-Host ""
Write-Host "6. EXPORT CSV (pour analyse):" -ForegroundColor Yellow
Write-Host "   Export-LlamaCppMetrics -DurationSeconds 120 -OutputPath 'metrics.csv'" -ForegroundColor White
Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
