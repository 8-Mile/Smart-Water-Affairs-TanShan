"""打包版启动入口：单进程同时提供 API 与前端页面（B/S 架构，绑定 0.0.0.0）。"""

from __future__ import annotations

import json
import os
import socket
import threading
import time
import urllib.request
import webbrowser

import uvicorn

from app.main import app


def _lan_ip() -> str | None:
    """获取本机在局域网中的 IP，供其他机器通过浏览器访问。"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except Exception:  # noqa: BLE001
        return None


def _healthy(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/api/v1/health", timeout=1.5) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        return bool((body.get("data") or {}).get("status") == "up")
    except Exception:  # noqa: BLE001
        return False


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        if sock.connect_ex(("127.0.0.1", port)) == 0:
            return False
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("0.0.0.0", port))
        return True
    except OSError:
        return False


def _existing_instance(base_port: int) -> str | None:
    """范围内已有本程序在运行则返回其地址，避免重复启动。"""
    for port in range(base_port, base_port + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                continue
        url = f"http://127.0.0.1:{port}"
        if _healthy(url):
            return url
    return None


def _open_browser_when_ready(base_url: str) -> None:
    for _ in range(180):
        if _healthy(base_url):
            break
        time.sleep(0.5)
    webbrowser.open(base_url)


def _write_access_info(port: int) -> None:
    """把访问地址写到数据目录和桌面，方便用户在其他机器的浏览器输入。"""
    data_dir = os.getcwd()
    lan = _lan_ip()
    lines = [
        "水务运维平台 访问地址",
        "====================",
        f"本机访问： http://127.0.0.1:{port}",
        f"局域网访问： http://{lan}:{port}" if lan else "局域网访问： 请查看本机 IP 地址",
        "",
        "其他电脑在同一局域网下，打开浏览器输入「局域网访问」地址即可使用。",
        "首次登录账号：admin  密码：admin123（登录后请立即修改）",
    ]
    content = "\n".join(lines)

    # 1) 数据目录（升级/备份时保留）
    with open(os.path.join(data_dir, "访问地址.txt"), "w", encoding="utf-8") as fh:
        fh.write(content)

    # 2) 桌面（甲方一眼能找到局域网地址）
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    if os.path.isdir(desktop):
        with open(
            os.path.join(desktop, "水务运维平台-访问地址.txt"), "w", encoding="utf-8"
        ) as fh:
            fh.write(content)

    # 3) 控制台（Windows .bat 窗口可见）
    for line in lines:
        print(line, flush=True)


def main() -> None:
    base_port = int(os.environ.get("APP_PORT", "8000"))
    running = _existing_instance(base_port)
    if running:
        webbrowser.open(running)
        return

    port = next(
        (p for p in range(base_port, base_port + 20) if _port_free(p)), base_port
    )
    base_url = f"http://127.0.0.1:{port}"
    port_file = os.environ.get("PORT_FILE")
    if port_file:
        with open(port_file, "w", encoding="utf-8") as fh:
            fh.write(str(port))

    _write_access_info(port)

    if os.environ.get("OPEN_BROWSER", "1") == "1":
        threading.Thread(
            target=_open_browser_when_ready, args=(base_url,), daemon=True
        ).start()

    # B/S 架构：绑定 0.0.0.0，允许局域网其他机器通过浏览器访问
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level=os.environ.get("LOG_LEVEL", "info"),
        access_log=False,
    )


if __name__ == "__main__":
    main()
