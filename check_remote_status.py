from __future__ import annotations

import paramiko


HOST = "47.115.223.144"
PORT = 22
USERNAME = "root"
PASSWORD = "Feiyue@1234"


def run(ssh: paramiko.SSHClient, command: str) -> None:
    print(f"\n=== {command} ===")
    stdin, stdout, stderr = ssh.exec_command(command)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    print(f"exit={exit_code}")
    if out.strip():
        print(out.strip())
    if err.strip():
        print(err.strip())


def main() -> None:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, PORT, USERNAME, PASSWORD, timeout=20)
    try:
        for command in [
            "docker ps -a --filter name=wealthtrack",
            "docker logs --tail 200 wealthtrack",
            "curl -I -s http://127.0.0.1/",
            "curl -s http://127.0.0.1:18001/health",
        ]:
            run(ssh, command)
    finally:
        ssh.close()


if __name__ == "__main__":
    main()
