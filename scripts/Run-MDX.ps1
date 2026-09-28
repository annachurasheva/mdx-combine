# Run-MDX.ps1 — чистый Edge c CDP для тестов mdx-combine
#Requires -Version 7.0

param(
    # Путь к профилю. ВСЕГДА вне репо! Чистота по доказанному v03.
    [string]$ProfileDir = "C:\Users\An\serv6675\Edge_test_mdx-combine",
    
    # Порт для CDP. Не меняйте без необходимости.
    [int]$Port = 9230,
    
    # Рабочий каталог вашего проекта.
    [string]$ProjectRoot = "C:\astro-projects\mdx-combine"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Ищем msedge.exe в стандартных местах.
$EdgeCandidates = @(
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramW6432}\Microsoft\Edge\Application\msedge.exe", # x86_64
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" # x86
)
$EdgePath = $EdgeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $EdgePath -or -not (Test-Path $EdgePath)) {
    Write-Error "Не найден Edge ни в одном из путей:`n$($EdgeCandidates -join ', ')"; exit 1
}

# Создаём профиль, если он ещё не существует.
if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
    Write-Host "[INFO] Создан новый профиль: $ProfileDir" -ForegroundColor Yellow
}

# Чистка кэшей (безопасно). НЕ трогаем Local Storage.
foreach ($cache in @("Cache", "Code Cache", "GPUCache", "ShaderCache")) {
    $path = Join-Path $ProfileDir "Default\$cache"
    if (Test-Path $path) {
        Remove-Item -Recurse -Force -LiteralPath $path -ErrorAction SilentlyContinue
        Write-Verbose "Очищено: $path"
    }
}

# Аргументы для запуска браузера.
$edgeArgs = @(
    "--user-data-dir=$ProfileDir",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update', # Отключить автообновление
    '--start-maximized',          # Запускать на весь экран
    '--disk-cache-size=1',       # Минимальный кэш
    '--media-cache-size=1',
    '--aggressive-cache-discard',
    '--disable-features=BackForwardCache',
    '--disable-session-crashed-bubble',
    "--remote-debugging-port=$Port", # ВАШ порт CDP
    "file:///$ProjectRoot/src/mdx-combine.html" # ВАША рабочая страница
)

Write-Host "`nЗапущен чистый профиль MDX-комбайна:" `
Write-Host "- Порт CDP: localhost:$Port" -ForegroundColor Green
Write-Host "- Папка профиля: $ProfileDir" -ForegroundColor DarkGray
Start-Process -FilePath $EdgePath -ArgumentList $edgeArgs