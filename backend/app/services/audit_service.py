"""操作日志维护：按保留期清理系统操作日志。"""

from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.archive import OperationLog


def cleanup_operation_logs(db: Session, retention_days: int | None = None) -> int:
    """删除超过保留期的系统操作日志，返回删除条数。

    仅清理 `sys_operation_log`；业务流转日志（告警/工单）属业务留痕，长期保留。
    """
    days = retention_days if retention_days is not None else get_settings().audit_log_retention_days
    if days <= 0:
        return 0
    cutoff = datetime.now() - timedelta(days=days)
    deleted = (
        db.query(OperationLog)
        .filter(OperationLog.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(deleted)
