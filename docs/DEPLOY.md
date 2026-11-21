# 生产运维管理系统 — 部署说明（P10）

## 1. 环境要求

| 组件 | 建议 |
|------|------|
| Python | 3.11+ |
| Node.js | 18+（构建前端） |
| MySQL | 8.x（生产推荐；开发可用 SQLite） |
| 反向代理 | Nginx |
| 操作系统 | Linux 或 Windows Server |

## 2. 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env：
# APP_ENV=prod
# DEBUG=false
# ENABLE_DOCS=false
# JWT_SECRET=<长随机串>
# DATABASE_URL=mysql+pymysql://user:pass@127.0.0.1:3306/water_ops?charset=utf8mb4
# UPLOAD_DIR=/data/water_ops/uploads
# CORS_ORIGINS=https://your-domain.com
```

创建数据库：

```sql
CREATE DATABASE water_ops DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

启动：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
```

或 systemd / nssm 托管进程。

## 3. 前端

```bash
cd frontend
npm install
npm run build
# 产物：frontend/dist
```

将 `dist` 部署到 Nginx 静态目录。

## 4. Nginx 示例

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/water_ops/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 55m;

        # WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

## 5. 安全清单

- [ ] 修改默认管理员密码（登录后调用「修改密码」接口或用户管理）
- [ ] 设置强 `JWT_SECRET`
- [ ] 生产 `APP_ENV=prod` 且关闭公开 API 文档
- [ ] CORS 仅允许业务域名
- [ ] 上传目录不在 Web 静态根下直接暴露
- [ ] 数据库账号最小权限
- [ ] 定期备份 MySQL + `uploads/`

## 6. 健康检查

```bash
curl http://127.0.0.1:8000/api/v1/health
```

期望 `data.status` 为 `up`，`checks.database.ok` 为 `true`。

## 7. 备份建议

| 项 | 频率 | 说明 |
|----|------|------|
| MySQL dump | 每日 | 业务库 |
| uploads 目录 | 每日 | 档案附件 |
| `.env` | 变更时 | 配置机密 |

## 8. 版本

当前应用版本：**1.0.0**（P0–P10 功能闭环可交付基线）。
