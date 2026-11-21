# 后端 — 生产运维管理系统

FastAPI + SQLAlchemy + JWT

## 快速开始

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- API 文档：http://localhost:8000/docs  
- 健康检查：`GET /api/v1/health`  
- 默认账号：`admin` / `admin123`

## 数据库

默认 `.env` 使用 SQLite（`./water_ops.db`），便于本地无 MySQL 时开发。

切换 MySQL 时修改：

```env
DATABASE_URL=mysql+pymysql://user:pass@127.0.0.1:3306/water_ops?charset=utf8mb4
```

请先建库：`CREATE DATABASE water_ops DEFAULT CHARSET utf8mb4;`

## 测试

```bash
pytest -q
```
