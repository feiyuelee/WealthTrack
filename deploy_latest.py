from __future__ import annotations

import posixpath
from pathlib import Path

import paramiko


HOST = "47.115.223.144"
PORT = 22
USERNAME = "root"
PASSWORD = "Feiyue@1234"
REMOTE_ROOT = "/opt/wealthtrack"

LOCAL_ROOT = Path(__file__).resolve().parent
FILES = [
    ".dockerignore",
    "Dockerfile",
    "backend.py",
    "index.html",
    "app.js",
    "styles.css",
    "requirements.txt",
    "DEPLOY_LINUX.md",
    "start.sh",
    "start.bat",
    "start.ps1",
]
DIRS = ["deploy"]


def ensure_remote_dir(sftp: paramiko.SFTPClient, path: str) -> None:
    if path in ("", "/"):
        return
    try:
        sftp.stat(path)
        return
    except FileNotFoundError:
        parent = posixpath.dirname(path)
        if parent and parent != path:
            ensure_remote_dir(sftp, parent)
        sftp.mkdir(path)


def upload_file(sftp: paramiko.SFTPClient, local_path: Path, remote_path: str) -> None:
    ensure_remote_dir(sftp, posixpath.dirname(remote_path))
    sftp.put(str(local_path), remote_path)
    print(f"uploaded: {local_path.name} -> {remote_path}")


def upload_dir(sftp: paramiko.SFTPClient, local_dir: Path, remote_dir: str) -> None:
    ensure_remote_dir(sftp, remote_dir)
    for item in local_dir.iterdir():
        remote_path = posixpath.join(remote_dir, item.name)
        if item.is_dir():
            upload_dir(sftp, item, remote_path)
        else:
            upload_file(sftp, item, remote_path)


def run(ssh: paramiko.SSHClient, command: str) -> tuple[int, str, str]:
    print(f"running: {command}")
    stdin, stdout, stderr = ssh.exec_command(command)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        print(out.strip())
    if err.strip():
        print(err.strip())
    return exit_code, out, err


def main() -> None:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USERNAME, PASSWORD, timeout=20)
    sftp = ssh.open_sftp()

    try:
        ensure_remote_dir(sftp, REMOTE_ROOT)
        ensure_remote_dir(sftp, f"{REMOTE_ROOT}/data")

        for relative in FILES:
            local_path = LOCAL_ROOT / relative
            upload_file(sftp, local_path, posixpath.join(REMOTE_ROOT, relative.replace("\\", "/")))

        for relative in DIRS:
            local_dir = LOCAL_ROOT / relative
            upload_dir(sftp, local_dir, posixpath.join(REMOTE_ROOT, relative.replace("\\", "/")))

        commands = [
            f"mkdir -p {REMOTE_ROOT}/data",
            f"cd {REMOTE_ROOT} && docker build -t wealthtrack .",
            "docker rm -f wealthtrack || true",
            f"docker run -d --name wealthtrack --restart unless-stopped -p 127.0.0.1:18001:8000 -v {REMOTE_ROOT}/data:/app/data wealthtrack",
            "curl -fsS http://127.0.0.1:18001/health",
            "curl -I -s http://127.0.0.1/",
        ]

        for command in commands:
            code, _, _ = run(ssh, command)
            if code != 0:
                raise SystemExit(f"remote command failed with exit code {code}: {command}")

    finally:
        sftp.close()
        ssh.close()


if __name__ == "__main__":
    main()
