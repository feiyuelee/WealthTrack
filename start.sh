#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "WealthTrack 启动中..."

python3 -c "import fastapi, uvicorn" >/dev/null 2>&1 || {
  echo "检测到缺少依赖，正在安装 requirements.txt ..."
  python3 -m pip install -r requirements.txt
}

echo "服务启动地址: http://127.0.0.1:8000"
exec python3 -m uvicorn backend:app --host 0.0.0.0 --port 8000
