# ============================================================================
# DIAGNOSTIC GPU - Vérifier votre GPU et les drivers
# ============================================================================

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "DIAGNOSTIC GPU - Verification complète" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Vérifier le GPU physique
Write-Host "1. GPU PHYSIQUE DETECTE:" -ForegroundColor Yellow
Write-Host "---" -ForegroundColor Gray

$gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion

if ($gpu) {
    $gpu | ForEach-Object {
        Write-Host "  Nom: $($_.Name)" -ForegroundColor Cyan
        $ramGB = [math]::Round($_.AdapterRAM / 1GB, 2)
        Write-Host "  Memoire: $ramGB GB" -ForegroundColor Cyan
        Write-Host "  Driver: $($_.DriverVersion)" -ForegroundColor Cyan
        Write-Host ""
    }
} else {
    Write-Host "  ERREUR: Aucun GPU detecte" -ForegroundColor Red
}

# 2. Vérifier nvidia-smi
Write-Host "2. NVIDIA DRIVERS:" -ForegroundColor Yellow
Write-Host "---" -ForegroundColor Gray

$nvidiaPath = "C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe"

if (Test-Path $nvidiaPath) {
    Write-Host "  TROUVE: $nvidiaPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Sortie nvidia-smi:" -ForegroundColor White
    & $nvidiaPath
} else {
    Write-Host "  NON TROUVE: $nvidiaPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Cherche dans les chemins alternatifs..." -ForegroundColor Yellow
    
    $altPaths = @(
        "C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\*\bin\nvidia-smi.exe",
        "C:\ProgramData\NVIDIA\NVIDIA GPU Computing Toolkit\CUDA\*\bin\nvidia-smi.exe"
    )
    
    foreach ($pattern in $altPaths) {
        $found = Get-Item -Path $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            Write-Host "  TROUVE ALTERNATIF: $($found.FullName)" -ForegroundColor Green
        }
    }
}

# 3. Vérifier les variables d'environnement GPU
Write-Host ""
Write-Host "3. VARIABLES D'ENVIRONNEMENT:" -ForegroundColor Yellow
Write-Host "---" -ForegroundColor Gray

$envVars = @("CUDA_PATH", "CUDA_HOME", "CUDAROOT", "OLLAMA_GPU_LAYERS", "LLAMA_CPP_GPU_LAYERS")

$envVars | ForEach-Object {
    $value = [Environment]::GetEnvironmentVariable($_)
    if ($value) {
        Write-Host "  $_=$value" -ForegroundColor Green
    } else {
        Write-Host "  $_ : (non defini)" -ForegroundColor Gray
    }
}

# 4. Type de GPU
Write-Host ""
Write-Host "4. TYPE DE GPU DETECTE:" -ForegroundColor Yellow
Write-Host "---" -ForegroundColor Gray

$gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object Name

if ($gpu) {
    $gpuName = $gpu.Name.ToLower()
    
    if ($gpuName -match "nvidia") {
        Write-Host "  Type: NVIDIA (CUDA compatible)" -ForegroundColor Green
    } elseif ($gpuName -match "amd") {
        Write-Host "  Type: AMD (ROCm compatible)" -ForegroundColor Magenta
    } elseif ($gpuName -match "intel") {
        Write-Host "  Type: Intel (OneAPI compatible)" -ForegroundColor Cyan
    } else {
        Write-Host "  Type: Inconnu" -ForegroundColor Yellow
    }
}

# 5. Processeur CPU
Write-Host ""
Write-Host "5. PROCESSEUR CPU:" -ForegroundColor Yellow
Write-Host "---" -ForegroundColor Gray

$cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors

$cpu | ForEach-Object {
    Write-Host "  Nom: $($_.Name)" -ForegroundColor Cyan
    Write-Host "  Cores: $($_.NumberOfCores)" -ForegroundColor Cyan
    Write-Host "  Threads: $($_.NumberOfLogicalProcessors)" -ForegroundColor Cyan
}

# 6. Résumé et recommandations
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "RECOMMANDATIONS:" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

$gpu = Get-CimInstance -ClassName Win32_VideoController | Select-Object Name
$gpuName = $gpu.Name.ToLower()

if ($gpuName -match "nvidia") {
    Write-Host "✅ Vous avez un GPU NVIDIA" -ForegroundColor Green
    Write-Host ""
    Write-Host "Pour l'utiliser avec llama.cpp:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Option 1: Verifier les drivers CUDA" -ForegroundColor Cyan
    Write-Host "  - Telechargez: https://developer.nvidia.com/cuda-downloads" -ForegroundColor White
    Write-Host "  - Selectionnez Windows et installez la derniere version" -ForegroundColor White
    Write-Host ""
    Write-Host "Option 2: Configurer node-llama-cpp avec GPU" -ForegroundColor Cyan
    Write-Host "  Dans llama-cpp.service.ts, ajouter:" -ForegroundColor White
    Write-Host "    gpuLayers: 30  // Ou plus selon votre VRAM" -ForegroundColor Gray
    Write-Host ""
    
} elseif ($gpuName -match "amd") {
    Write-Host "✅ Vous avez un GPU AMD" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Pour l'utiliser avec llama.cpp:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Installez ROCm:" -ForegroundColor Cyan
    Write-Host "  - Telechargez: https://www.amd.com/en/technologies/rocm.html" -ForegroundColor White
    Write-Host "  - Selectionnez Windows et installez ROCm Toolkit" -ForegroundColor White
    Write-Host ""
    
} else {
    Write-Host "⚠️  GPU non NVIDIA detecte" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Vous avez 3 options:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Option 1: Utiliser le CPU (recommande pour llama.cpp sans GPU)" -ForegroundColor White
    Write-Host "  - C'est ce que vous faites probablement maintenant" -ForegroundColor Gray
    Write-Host "  - Performance acceptable pour Mistral 7B" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Option 2: Acheter un GPU NVIDIA compatible" -ForegroundColor White
    Write-Host "  - RTX 3060 ou superior (12+ GB VRAM)" -ForegroundColor Gray
    Write-Host "  - Installez les drivers CUDA" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Option 3: Utiliser une API cloud (Groq, Together.ai)" -ForegroundColor White
    Write-Host "  - Pas besoin de GPU local" -ForegroundColor Gray
    Write-Host "  - Tres rapide (10-50ms)" -ForegroundColor Gray
    Write-Host ""
}

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "POUR MONITORER SANS GPU:" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Utilisez simplement:" -ForegroundColor Yellow
Write-Host "  Watch-LlamaCppMemory -IntervalSeconds 2" -ForegroundColor White
Write-Host ""
Write-Host "Cela montre:" -ForegroundColor Yellow
Write-Host "  - RAM utilisee par Node.js" -ForegroundColor Gray
Write-Host "  - Usage CPU" -ForegroundColor Gray
Write-Host "  - Nombre de threads" -ForegroundColor Gray
Write-Host ""
