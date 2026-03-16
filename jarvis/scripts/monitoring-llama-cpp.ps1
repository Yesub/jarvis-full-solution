# ============================================================================
# Monitoring Scripts for llama.cpp (node-llama-cpp process)
# Author: Claude
# Usage: Run in PowerShell as Administrator
# ============================================================================

# ============================================================================
# 1. SIMPLE : Vue en temps réel (RAM + CPU) - QUICK START
# ============================================================================

function Get-LlamaCppMemory {
    <#
    .SYNOPSIS
    Affiche l'utilisation RAM et CPU du processus Node.js (llama.cpp)
    .EXAMPLE
    Get-LlamaCppMemory
    #>
    
    $processes = Get-Process -Name node -ErrorAction SilentlyContinue
    
    if (-not $processes) {
        Write-Host "❌ Aucun processus 'node' détecté. Avez-vous lancé 'npm run start:dev' ?" -ForegroundColor Red
        return
    }

    Write-Host "`n📊 Processus Node.js (llama.cpp)" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    
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

# Utilisation : Get-LlamaCppMemory


# ============================================================================
# 2. MONITORING EN CONTINU (Refresh auto)
# ============================================================================

function Watch-LlamaCppMemory {
    <#
    .SYNOPSIS
    Affiche l'utilisation RAM/CPU du processus Node.js toutes les 2 secondes (Ctrl+C pour arrêter)
    .PARAMETER IntervalSeconds
    Intervalle de rafraîchissement en secondes (défaut: 2)
    .EXAMPLE
    Watch-LlamaCppMemory -IntervalSeconds 1
    #>
    
    param(
        [int]$IntervalSeconds = 2
    )
    
    $count = 0
    
    while ($true) {
        Clear-Host
        $count++
        Write-Host "🔄 Monitoring llama.cpp [Refresh #$count] - Intervalle: ${IntervalSeconds}s (Ctrl+C pour arrêter)" -ForegroundColor Green
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        
        $processes = Get-Process -Name node -ErrorAction SilentlyContinue
        
        if (-not $processes) {
            Write-Host "❌ Processus Node.js non détecté" -ForegroundColor Red
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
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        Write-Host "📈 Total Système: $usedRamGB / $systemRamGB GB ($percentUsed%)" -ForegroundColor Green
        Write-Host ""
        
        Start-Sleep -Seconds $IntervalSeconds
    }
}

# Utilisation : Watch-LlamaCppMemory
# Ou avec intervalle custom : Watch-LlamaCppMemory -IntervalSeconds 1


# ============================================================================
# 3. DÉTAIL AVANCÉ (RAM virtuelle + privée + pagefile)
# ============================================================================

function Get-LlamaCppDetailedMemory {
    <#
    .SYNOPSIS
    Affiche les détails complets de l'utilisation mémoire (Virtual, Private, Pagefile)
    .EXAMPLE
    Get-LlamaCppDetailedMemory
    #>
    
    $processes = Get-Process -Name node -ErrorAction SilentlyContinue
    
    if (-not $processes) {
        Write-Host "❌ Aucun processus 'node' détecté" -ForegroundColor Red
        return
    }

    Write-Host "`n📊 Détail Mémoire - Processus Node.js (llama.cpp)" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    
    $processes | ForEach-Object {
        $workingSetMB = [math]::Round($_.WorkingSet / 1MB, 2)
        $virtualMemMB = [math]::Round($_.VirtualMemorySize / 1MB, 2)
        $peakWorkingSetMB = [math]::Round($_.PeakWorkingSet / 1MB, 2)
        $peakVirtualMemMB = [math]::Round($_.PeakVirtualMemorySize / 1MB, 2)
        
        Write-Host "`nPID: $($_.Id)" -ForegroundColor Yellow
        Write-Host "  Working Set (RAM physique)    : $workingSetMB MB"
        Write-Host "  Virtual Memory                : $virtualMemMB MB"
        Write-Host "  Peak Working Set              : $peakWorkingSetMB MB"
        Write-Host "  Peak Virtual Memory           : $peakVirtualMemMB MB"
        Write-Host "  Difference (Virtual - Phys)   : $([math]::Round($virtualMemMB - $workingSetMB, 2)) MB"
    }
    Write-Host ""
}

# Utilisation : Get-LlamaCppDetailedMemory


# ============================================================================
# 4. PERFORMANCE COUNTERS (Très détaillé - nécessite Admin)
# ============================================================================

function Get-LlamaCppPerformanceCounters {
    <#
    .SYNOPSIS
    Récupère les counters performance détaillés (I/O, faults, etc.)
    Nécessite: Exécution en tant qu'Administrateur
    .EXAMPLE
    Get-LlamaCppPerformanceCounters
    #>
    
    $processes = Get-Process -Name node -ErrorAction SilentlyContinue
    
    if (-not $processes) {
        Write-Host "❌ Aucun processus 'node' détecté" -ForegroundColor Red
        return
    }

    Write-Host "`n⚙️  Performance Counters - Processus Node.js (llama.cpp)" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    
    $processes | ForEach-Object {
        $procName = $_.ProcessName
        $procId = $_.Id
        
        Write-Host "`nPID: $procId" -ForegroundColor Yellow
        
        try {
            $perfCounters = Get-Counter -Counter @(
                "\Process($procName#$([array]::IndexOf($(Get-Process $procName).Id, $procId)))\Page Faults/sec",
                "\Process($procName#$([array]::IndexOf($(Get-Process $procName).Id, $procId)))\% Processor Time"
            ) -ErrorAction SilentlyContinue
            
            $perfCounters.CounterSamples | ForEach-Object {
                $value = [math]::Round($_.CookedValue, 2)
                Write-Host "  $($_.Path): $value"
            }
        } catch {
            Write-Host "  ⚠️  Performance counters non disponibles (nécessite Admin et setup préalable)" -ForegroundColor Yellow
        }
    }
    Write-Host ""
}

# Utilisation : Get-LlamaCppPerformanceCounters


# ============================================================================
# 5. GPU MONITORING (NVIDIA/AMD - Nécessite GPU drivers)
# ============================================================================

function Get-LlamaCppGPUUsage {
    <#
    .SYNOPSIS
    Affiche l'utilisation GPU (NVIDIA CUDA ou AMD)
    Nécessite: NVIDIA drivers ou AMD drivers installés
    .EXAMPLE
    Get-LlamaCppGPUUsage
    #>
    
    Write-Host "`n🎮 GPU Usage" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    
    # 1. Vérifier NVIDIA GPU (nvidia-smi)
    $nvidiaPath = "C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"
    
    if (Test-Path $nvidiaPath) {
        Write-Host "`n🟢 NVIDIA GPU détecté" -ForegroundColor Green
        Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
        
        try {
            $nvidiaOutput = & $nvidiaPath --query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory --format=csv,noheader,nounits
            
            Write-Host "Index | GPU Name | Total Mem | Used Mem | Free Mem | GPU Load | Mem Load"
            Write-Host "───── | ──────── | ───────── | ──────── | ──────── | ──────── | ────────"
            
            $nvidiaOutput | ForEach-Object {
                Write-Host $_
            }
            
            # Processus utilisant le GPU
            Write-Host "`nProcessus utilisant le GPU:"
            Write-Host "───────────────────────────"
            $procOutput = & $nvidiaPath --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits
            $procOutput | ForEach-Object {
                if ($_ -and $_ -ne "") {
                    Write-Host $_
                }
            }
        } catch {
            Write-Host "⚠️  Erreur lors de l'exécution de nvidia-smi" -ForegroundColor Yellow
        }
    } else {
        Write-Host "⚠️  NVIDIA GPU non détecté (nvidia-smi non trouvé)" -ForegroundColor Yellow
    }
    
    # 2. Vérifier AMD GPU
    Write-Host "`n"
    $amdPath = "C:\Program Files\AMD\RyzenMasterService\bin\RyzenMonitor.exe"
    
    if (Test-Path $amdPath) {
        Write-Host "🔴 AMD GPU détecté (RyzenMaster)" -ForegroundColor Yellow
        Write-Host "⚠️  Utiliser l'application RyzenMaster pour voir la GPU Memory" -ForegroundColor Yellow
    } else {
        Write-Host "⚠️  AMD GPU non détecté" -ForegroundColor Gray
    }
    
    Write-Host ""
}

# Utilisation : Get-LlamaCppGPUUsage


# ============================================================================
# 6. DASHBOARD COMPLET (Le meilleur pour tout voir)
# ============================================================================

function Show-LlamaCppDashboard {
    <#
    .SYNOPSIS
    Affiche un dashboard complet RAM + GPU + CPU (mise à jour en continu)
    .PARAMETER IntervalSeconds
    Intervalle de rafraîchissement en secondes (défaut: 2)
    .EXAMPLE
    Show-LlamaCppDashboard -IntervalSeconds 1
    #>
    
    param(
        [int]$IntervalSeconds = 2
    )
    
    $count = 0
    
    while ($true) {
        Clear-Host
        $count++
        $timestamp = Get-Date -Format "HH:mm:ss"
        
        Write-Host "╔════════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
        Write-Host "║                    LLAMA.CPP MONITORING DASHBOARD                          ║" -ForegroundColor Cyan
        Write-Host "║                   $timestamp | Refresh #$count | Intervalle: ${IntervalSeconds}s                   ║" -ForegroundColor Cyan
        Write-Host "╚════════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
        
        # ===== RAM =====
        Write-Host "`n📊 RAM USAGE" -ForegroundColor Green
        Write-Host "──────────────────────────────────────────────────────────────────────────────" -ForegroundColor Green
        
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
            $ramBar = Get-ProgressBar $percentUsed 50
            
            Write-Host "  ├─ Total Système: $usedRamGB / $systemRamGB GB ($percentUsed%)" -ForegroundColor Yellow
            Write-Host "  └─ $ramBar" -ForegroundColor Yellow
        } else {
            Write-Host "  ❌ Aucun processus Node.js détecté" -ForegroundColor Red
        }
        
        # ===== GPU =====
        Write-Host "`n🎮 GPU USAGE (NVIDIA)" -ForegroundColor Magenta
        Write-Host "──────────────────────────────────────────────────────────────────────────────" -ForegroundColor Magenta
        
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
                    
                    Write-Host "  ├─ Memory: $usedMem MB / $totalMem MB ($gpuPercent%)" -ForegroundColor Cyan
                    Write-Host "  ├─ GPU Load: $([int]$gpuUtil)%" -ForegroundColor Cyan
                    
                    $gpuBar = Get-ProgressBar $gpuPercent 50
                    Write-Host "  └─ $gpuBar" -ForegroundColor Cyan
                }
            } catch {
                Write-Host "  ⚠️  Erreur nvidia-smi" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ⚠️  NVIDIA GPU non détecté" -ForegroundColor Gray
        }
        
        # ===== CPU =====
        Write-Host "`n⚡ CPU USAGE" -ForegroundColor Yellow
        Write-Host "──────────────────────────────────────────────────────────────────────────────" -ForegroundColor Yellow
        
        if ($processes) {
            $cpuPercent = [math]::Round((($processes | Measure-Object -Property CPU -Sum).Sum / [Environment]::ProcessorCount) * 2, 1)
            $cpuBar = Get-ProgressBar $cpuPercent 50
            Write-Host "  ├─ CPU Load: $cpuPercent%" -ForegroundColor Yellow
            Write-Host "  └─ $cpuBar" -ForegroundColor Yellow
        }
        
        Write-Host "`n╚════════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
        
        Start-Sleep -Seconds $IntervalSeconds
    }
}

# Helper function pour la barre de progression
function Get-ProgressBar {
    param(
        [double]$percent,
        [int]$width = 30
    )
    
    $filled = [math]::Round(($percent / 100) * $width)
    $empty = $width - $filled
    
    $bar = "[" + ("=" * $filled) + (" " * $empty) + "] $percent%"
    
    if ($percent -lt 50) {
        return $bar | Write-Output
    } elseif ($percent -lt 80) {
        return $bar | Write-Output
    } else {
        return $bar | Write-Output
    }
}

# Utilisation : Show-LlamaCppDashboard
# Ou : Show-LlamaCppDashboard -IntervalSeconds 1


# ============================================================================
# 7. EXPORT LOGS (Sauvegarde les données dans un CSV)
# ============================================================================

function Export-LlamaCppMetrics {
    <#
    .SYNOPSIS
    Sauvegarde les métriques RAM/GPU dans un fichier CSV (pour analyse ultérieure)
    .PARAMETER OutputPath
    Chemin du fichier CSV (défaut: llama-metrics.csv dans le dossier courant)
    .PARAMETER DurationSeconds
    Durée du monitoring en secondes (défaut: 60)
    .EXAMPLE
    Export-LlamaCppMetrics -DurationSeconds 120 -OutputPath "C:\logs\llama-metrics.csv"
    #>
    
    param(
        [string]$OutputPath = "llama-metrics.csv",
        [int]$DurationSeconds = 60
    )
    
    $startTime = Get-Date
    $endTime = $startTime.AddSeconds($DurationSeconds)
    $metrics = @()
    
    Write-Host "📝 Export des métriques en cours ($DurationSeconds sec) vers: $OutputPath" -ForegroundColor Green
    
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
    Write-Host "✅ Export terminé: $OutputPath" -ForegroundColor Green
    Write-Host "📊 $($metrics.Count) lignes enregistrées" -ForegroundColor Green
}

# Utilisation : Export-LlamaCppMetrics -DurationSeconds 120


# ============================================================================
# 8. QUICK REFERENCE (Commandes prêtes à copier)
# ============================================================================

Write-Host @"
╔════════════════════════════════════════════════════════════════════════════╗
║                      LLAMA.CPP MONITORING - QUICK REFERENCE                ║
╚════════════════════════════════════════════════════════════════════════════╝

1️⃣  AFFICHAGE SIMPLE (une fois) :
   Get-LlamaCppMemory

2️⃣  MONITORING EN CONTINU (Ctrl+C pour arrêter) :
   Watch-LlamaCppMemory -IntervalSeconds 2

3️⃣  DÉTAIL MÉMOIRE (Virtual + Private + Peak) :
   Get-LlamaCppDetailedMemory

4️⃣  GPU USAGE (NVIDIA) :
   Get-LlamaCppGPUUsage

5️⃣  DASHBOARD COMPLET (RAM + GPU + CPU) :
   Show-LlamaCppDashboard -IntervalSeconds 1

6️⃣  EXPORT CSV (pour analyse) :
   Export-LlamaCppMetrics -DurationSeconds 120 -OutputPath "metrics.csv"

7️⃣  PERFORMANCE COUNTERS (Admin requis) :
   Get-LlamaCppPerformanceCounters

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️  CONFIGURATION RECOMMANDÉE :
   1. Lancez votre app: npm run start:dev
   2. Ouvrez une deuxième PowerShell
   3. Collez dans la deuxième PowerShell:
      Show-LlamaCppDashboard -IntervalSeconds 1

🔧 NVIDIA GPU MONITORING (Alternative) :
   nvidia-smi -l 1        # Refresh auto toutes les 1 seconde
   
   OU utilisez GPU-Z (gratuit) : https://www.techpowerup.com/download/gpu-z/

📊 TASK MANAGER Alternative (GUI) :
   Taskbar → Ctrl+Shift+Esc → Onglet "Processus" → Chercher "node"

"@ -ForegroundColor Cyan
