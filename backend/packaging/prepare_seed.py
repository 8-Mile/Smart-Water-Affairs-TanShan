"""准备安装包内置的种子数据库。

- 复制当前清洗后的业务库（点位表、设备、告警规则、历史数据）
- 重置 admin 密码为安装包默认值，并移除演示账号
- 清空页面保存的 SCADA 配置，让安装包统一使用 .env 默认值
"""

from __future__ import annotations

import shutil
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.core.security import hash_password  # noqa: E402

DEFAULT_ADMIN_PASSWORD = "admin123"
SOURCE_DB = BACKEND / "water_ops.db"
TARGET_DB = BACKEND / "build" / "seed" / "water_ops.db"


def main() -> None:
    if not SOURCE_DB.is_file():
        raise SystemExit(f"未找到业务库：{SOURCE_DB}")
    TARGET_DB.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE_DB, TARGET_DB)

    con = sqlite3.connect(TARGET_DB)
    con.execute(
        "update sys_user set password_hash=?, status=1, deleted=0 where username='admin'",
        (hash_password(DEFAULT_ADMIN_PASSWORD),),
    )
    for username in ("demo", "leader", "operator"):
        row = con.execute(
            "select id from sys_user where username=?", (username,)
        ).fetchone()
        if row:
            con.execute("delete from sys_user_role where user_id=?", (row[0],))
            con.execute("delete from sys_user where id=?", (row[0],))
    con.execute("delete from scada_config")
    con.commit()
    con.execute("vacuum")
    con.close()
    print(f"[prepare_seed] {TARGET_DB} ({TARGET_DB.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
