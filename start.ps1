$ErrorActionPreference = "Stop"

Set-Location -Path $PSScriptRoot

Write-Host "WealthTrack 启动中..." -ForegroundColor Cyan

try {
    python -c "import fastapi, uvicorn" | Out-Null
} catch {
    Write-Host "检测到缺少依赖，正在安装 requirements.txt ..." -ForegroundColor Yellow
    python -m pip install -r requirements.txt
}

Write-Host "服务启动地址: http://127.0.0.1:8000" -ForegroundColor Green
python -m uvicorn backend:app --host 0.0.0.0 --port 8000 --reload
