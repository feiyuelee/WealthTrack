# WealthTrack Linux 部署说明

## 1. 准备环境

建议环境：

- Ubuntu 22.04 或 24.04
- Python 3.11+
- Nginx
- systemd

安装基础依赖：

```bash
sudo apt update
sudo apt install -y python3 python3-pip nginx
```

## 2. 上传项目

把项目放到服务器，例如：

```bash
sudo mkdir -p /opt/wealthtrack
sudo chown -R $USER:$USER /opt/wealthtrack
```

然后把项目文件上传到 `/opt/wealthtrack`。

## 3. 安装 Python 依赖

进入项目目录：

```bash
cd /opt/wealthtrack
python3 -m pip install -r requirements.txt
```

## 4. 本地启动测试

先直接测试应用能否启动：

```bash
chmod +x start.sh
./start.sh
```

浏览器访问：

```text
http://服务器IP:8000
```

## 5. 配置 systemd

把服务文件复制到 systemd：

```bash
sudo cp deploy/wealthtrack.service /etc/systemd/system/wealthtrack.service
```

编辑服务文件，至少修改这两项：

- `WorkingDirectory=/opt/wealthtrack`
- `Environment=WEALTHTRACK_SECRET=换成你自己的强随机密钥`

如果你的 Python 路径不是 `/usr/bin/python3`，也要同步修改 `ExecStart`。

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable wealthtrack
sudo systemctl start wealthtrack
sudo systemctl status wealthtrack
```

## 6. 配置 Nginx

复制配置文件：

```bash
sudo cp deploy/nginx-wealthtrack.conf /etc/nginx/sites-available/wealthtrack
```

修改：

- `server_name your-domain.com` 改成你的域名或服务器 IP

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/wealthtrack /etc/nginx/sites-enabled/wealthtrack
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 数据库位置

SQLite 数据库默认在：

```text
/opt/wealthtrack/data/wealthtrack.db
```

这个文件非常重要，记得定期备份。

## 8. 备份建议

最简单的备份方式：

```bash
cp /opt/wealthtrack/data/wealthtrack.db /opt/wealthtrack/data/wealthtrack-$(date +%F).db
```

可以再配合 `cron` 每天自动备份。

## 9. 生产建议

- 不要在生产环境使用 `--reload`
- 一定要设置 `WEALTHTRACK_SECRET`
- 建议只让 `uvicorn` 监听 `127.0.0.1`
- 通过 Nginx 暴露公网访问
- 后续用户变多时可以把 SQLite 升级为 PostgreSQL
