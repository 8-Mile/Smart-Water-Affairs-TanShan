"""开发期轻量 schema 同步：create_all + SQLite 缺列补丁。"""

from sqlalchemy import inspect, text

from app.core.database import Base, engine


def _add_missing_columns(table: str, columns: dict[str, str]) -> None:
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns(table)}
    patches = []
    for name, col_type in columns.items():
        if name not in existing:
            patches.append(f"ALTER TABLE {table} ADD COLUMN {name} {col_type}")
    if not patches:
        return
    with engine.begin() as conn:
        for sql in patches:
            conn.execute(text(sql))


def ensure_schema() -> None:
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name != "sqlite":
        return

    _add_missing_columns(
        "sys_user",
        {
            "phone": "VARCHAR(32)",
            "department_id": "INTEGER",
            "team_id": "INTEGER",
            "temp_expire_at": "DATETIME",
            "token_version": "INTEGER DEFAULT 0",
        },
    )
    _add_missing_columns(
        "sys_role",
        {
            "data_scope": "VARCHAR(16) DEFAULT 'all'",
            "perms_seeded": "INTEGER DEFAULT 0",
        },
    )
    _add_missing_columns(
        "insp_task",
        {
            "assignee_id": "INTEGER",
            "assignee_name": "VARCHAR(64)",
        },
    )
    _add_missing_columns(
        "insp_action_log",
        {
            "record_id": "INTEGER",
        },
    )
    _add_missing_columns(
        "alarm",
        {
            # ignore_reason 退役改名为 reject_reason（旧列残留不管，存量不迁移）
            "reject_reason": "VARCHAR(128)",
        },
    )
    _add_missing_columns(
        "repair_order",
        {
            "inspection_record_id": "INTEGER",
            "maintenance_record_id": "INTEGER",
            "repair_type": "VARCHAR(32) DEFAULT 'overhaul'",
            "fault_category": "VARCHAR(64)",
            "fault_time": "DATETIME",
            "apply_images": "TEXT",
            "approver_id": "INTEGER",
            "approver_name": "VARCHAR(64)",
            "approve_time": "DATETIME",
            "approve_comment": "VARCHAR(255)",
            "worker_id": "INTEGER",
            "worker_name": "VARCHAR(64)",
            "process_start_time": "DATETIME",
            "process_end_time": "DATETIME",
            "process_feedback": "TEXT",
            "process_images": "TEXT",
            "acceptor_id": "INTEGER",
            "acceptor_name": "VARCHAR(64)",
            "accept_time": "DATETIME",
            "accept_comment": "VARCHAR(255)",
        },
    )
    _add_missing_columns(
        "doc_archive",
        {
            "archive_no": "VARCHAR(32)",
            "source": "VARCHAR(32)",
            "related_order": "VARCHAR(32)",
            "related_equipment": "VARCHAR(128)",
            "related_matter": "VARCHAR(255)",
        },
    )
    _add_missing_columns(
        "maint_plan",
        {
            "need_accept": "INTEGER DEFAULT 0",
            "default_assignee_id": "INTEGER DEFAULT 0",
            "default_assignee_name": "VARCHAR(64)",
        },
    )
    _add_missing_columns(
        "maint_record",
        {
            "acceptor_id": "INTEGER",
            "acceptor_name": "VARCHAR(64)",
            "accept_time": "DATETIME",
            "accept_comment": "VARCHAR(255)",
        },
    )
    _add_missing_columns(
        "scada_points",
        {
            "tag_id": "INTEGER",
            "equipment_id": "INTEGER",
            "point_category": "VARCHAR(32)",
            "min_value": "NUMERIC(18, 4)",
            "max_value": "NUMERIC(18, 4)",
            "hi": "NUMERIC(18, 4)",
            "lo": "NUMERIC(18, 4)",
            "hihi": "NUMERIC(18, 4)",
            "lolo": "NUMERIC(18, 4)",
            "alarm_group": "VARCHAR(64)",
            "his_rec_interval": "INTEGER",
            "io_access": "VARCHAR(256)",
        },
    )
    _add_missing_columns(
        "eq_equipment",
        {
            "parent_id": "INTEGER",
            "rated_params": "TEXT",
            "unit_no": "INTEGER",
            "pump_type": "VARCHAR(32)",
            "rated_power_kw": "FLOAT",
            "rated_current_a": "FLOAT",
            "rated_voltage_kv": "FLOAT",
            "rated_head_m": "FLOAT",
            "rated_flow_m3s": "FLOAT",
            "blade_angle_min": "FLOAT",
            "blade_angle_max": "FLOAT",
            "continuous_stop_hours": "FLOAT DEFAULT 0",
        },
    )
