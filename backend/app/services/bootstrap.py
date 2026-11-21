"""首次启动种子数据。"""

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from datetime import date, datetime
from decimal import Decimal

from app.models.alarm import AlarmType
from app.models.analytics import ElectricityPrice
from app.models.archive import Archive, ArchiveCategory
from app.models.equipment import EquipmentType
from app.models.org import Department, Location
from app.models.rbac import Menu, Role, RoleMenu, UserRole
from app.models.repair import RepairOrder
from app.models.scada import ScadaPoint
from app.models.user import User

DEFAULT_TYPES = [
    ("主机组类", "CAT-PUMP", "核心主水泵机组"),
    ("闸门类", "CAT-GATE", "各类进水/出水闸门"),
    ("电气类", "CAT-ELECTRIC", "高低压配电设备"),
    ("辅机类", "CAT-AUX", "辅助生产设备"),
    ("仪器仪表类", "CAT-INSTRUMENT", "监测仪表"),
    ("通信类", "CAT-COMM", "通信设备"),
    ("环境与安防类", "CAT-ENV", "环境监测与安防设施"),
]

# parent path key -> children
# 菜单结构（2026-10-04 扁平化：11 个一级，最深 2 层；图标统一 Iconify ri: 前缀）
# 告警已融合为单页 4Tab（实时/历史/规则/类型）；供水+耗能合为「数据统计」；
# 测点配置并入实时监控页 Tab；巡检/维保/厂商/组织/权限均为多 Tab 单页。
MENU_SEED = [
    {
        "name": "工作台",
        "path": "/dashboard",
        "component": "dashboard",
        "icon": "ri:home-smile-2-line",
        "sort": 1,
        "menu_type": "menu",
        "perms": "dashboard:view",
    },
    {
        "name": "告警中心",
        "path": "/alarm/realtime",
        "component": "alarm/realtime",
        "icon": "ri:alarm-warning-line",
        "sort": 2,
        "menu_type": "menu",
        "perms": "alarm:realtime",
    },
    {
        "name": "维修工单",
        "path": "/repair/list",
        "component": "repair/list",
        "icon": "ri:coupon-line",
        "sort": 3,
        "menu_type": "menu",
        "perms": "repair:list",
    },
    {
        "name": "实时监控",
        "path": "/scada/monitor",
        "component": "scada/monitor",
        "icon": "ri:radar-line",
        "sort": 4,
        "menu_type": "menu",
        "perms": "scada:monitor",
    },
    {
        "name": "设备资产",
        "icon": "ri:computer-line",
        "sort": 5,
        "menu_type": "directory",
        "children": [
            {
                "name": "设备台账",
                "path": "/equipment/list",
                "component": "equipment/list",
                "icon": "ri:server-line",
                "sort": 1,
                "perms": "eq:list",
            },
            {
                "name": "设备维护",
                "path": "/maintenance/plans",
                "component": "maintenance/plans",
                "icon": "ri:tools-line",
                "sort": 2,
                "perms": "maint:plan:list",
            },
            {
                "name": "厂商管理",
                "path": "/equipment/maintenance-vendors",
                "component": "equipment/maintenance-vendors",
                "icon": "ri:truck-line",
                "sort": 3,
                "perms": "eq:maintainer:list",
            },
        ],
    },
    {
        "name": "调度指令",
        "path": "/dispatch/stats",
        "component": "dispatch/stats",
        "icon": "ri:send-plane-line",
        "sort": 6,
        "menu_type": "menu",
        "perms": "dispatch:stats",
    },
    {
        "name": "数据统计",
        "icon": "ri:pie-chart-2-line",
        "sort": 7,
        "menu_type": "directory",
        "children": [
            {
                "name": "供水统计",
                "path": "/water/stats",
                "component": "water/stats",
                "icon": "ri:drizzle-line",
                "sort": 1,
                "perms": "water:stats",
            },
            {
                "name": "耗能分析",
                "path": "/energy/stats",
                "component": "energy/stats",
                "icon": "ri:line-chart-line",
                "sort": 2,
                "perms": "energy:stats",
            },
        ],
    },
    {
        "name": "设备巡检",
        "path": "/inspection/tasks",
        "component": "inspection/tasks",
        "icon": "ri:list-check-2",
        "sort": 8,
        "menu_type": "menu",
        "perms": "insp:task:list",
    },
    {
        "name": "档案管理",
        "path": "/archive",
        "component": "archive/index",
        "icon": "ri:archive-drawer-line",
        "sort": 9,
        "menu_type": "menu",
        "perms": "archive:list",
    },
    {
        "name": "系统管理",
        "path": "/system",
        "icon": "ri:settings-3-line",
        "sort": 10,
        "menu_type": "directory",
        "children": [
            {
                "name": "组织设置",
                "path": "/system/departments",
                "component": "system/departments",
                "icon": "ri:building-2-line",
                "sort": 1,
                "perms": "sys:dept:list",
            },
            {
                "name": "权限管理",
                "path": "/system/users",
                "component": "system/users",
                "icon": "ri:user-line",
                "sort": 2,
                "perms": "sys:user:list",
            },
            {
                "name": "操作日志",
                "path": "/system/logs",
                "component": "system/logs",
                "icon": "ri:file-list-3-line",
                "sort": 3,
                "perms": "sys:log:list",
            },
            {
                "name": "SCADA 接入",
                "path": "/system/scada",
                "component": "system/scada",
                "icon": "ri:link-line",
                "sort": 4,
                "perms": "sys:scada:config",
            },
        ],
    },
]


# 按钮权限种子数据（menu_type='button'，挂在对应叶子菜单下）
# 字段：name 按钮名 / perms 权限码 / parent_perms 父菜单的 perms（用于查找父菜单 id）
BUTTON_SEED = [
    # 设备台账
    {"name": "新增设备", "perms": "eq:create", "parent_perms": "eq:list", "sort": 1},
    {"name": "编辑设备", "perms": "eq:update", "parent_perms": "eq:list", "sort": 2},
    {"name": "删除设备", "perms": "eq:delete", "parent_perms": "eq:list", "sort": 3},
    {"name": "导入设备", "perms": "eq:import", "parent_perms": "eq:list", "sort": 4},
    # 设备维护
    {"name": "新增维保计划", "perms": "maint:plan:create", "parent_perms": "maint:plan:list", "sort": 1},
    {"name": "编辑维保计划", "perms": "maint:plan:update", "parent_perms": "maint:plan:list", "sort": 2},
    {"name": "删除维保计划", "perms": "maint:plan:delete", "parent_perms": "maint:plan:list", "sort": 3},
    # 厂商管理
    {"name": "新增厂商", "perms": "eq:maintainer:create", "parent_perms": "eq:maintainer:list", "sort": 1},
    {"name": "编辑厂商", "perms": "eq:maintainer:update", "parent_perms": "eq:maintainer:list", "sort": 2},
    {"name": "删除厂商", "perms": "eq:maintainer:delete", "parent_perms": "eq:maintainer:list", "sort": 3},
    # 维修工单
    {"name": "派单", "perms": "repair:dispatch", "parent_perms": "repair:list", "sort": 1},
    {"name": "完工提交", "perms": "repair:process", "parent_perms": "repair:list", "sort": 2},
    {"name": "验收", "perms": "repair:accept", "parent_perms": "repair:list", "sort": 3},
    {"name": "驳回", "perms": "repair:reject", "parent_perms": "repair:list", "sort": 4},
    # 告警中心
    {"name": "派发告警", "perms": "alarm:dispatch", "parent_perms": "alarm:realtime", "sort": 1},
    {"name": "处理告警", "perms": "alarm:handle", "parent_perms": "alarm:realtime", "sort": 2},
    {"name": "验收告警", "perms": "alarm:accept", "parent_perms": "alarm:realtime", "sort": 3},
    {"name": "关闭告警", "perms": "alarm:close", "parent_perms": "alarm:realtime", "sort": 4},
    # 调度指令
    {"name": "审核调度", "perms": "dispatch:audit", "parent_perms": "dispatch:stats", "sort": 1},
    {"name": "新建调度", "perms": "dispatch:create", "parent_perms": "dispatch:stats", "sort": 2},
    {"name": "编辑调度", "perms": "dispatch:update", "parent_perms": "dispatch:stats", "sort": 3},
    {"name": "删除调度", "perms": "dispatch:delete", "parent_perms": "dispatch:stats", "sort": 4},
    {"name": "执行完毕", "perms": "dispatch:execute", "parent_perms": "dispatch:stats", "sort": 5},
    # 设备巡检
    {"name": "派发巡检", "perms": "insp:task:create", "parent_perms": "insp:task:list", "sort": 1},
    {"name": "编辑巡检", "perms": "insp:task:update", "parent_perms": "insp:task:list", "sort": 2},
    {"name": "删除巡检", "perms": "insp:task:delete", "parent_perms": "insp:task:list", "sort": 3},
    {"name": "提交记录", "perms": "insp:record:submit", "parent_perms": "insp:task:list", "sort": 4},
    {"name": "新增计划", "perms": "insp:plan:create", "parent_perms": "insp:task:list", "sort": 5},
    {"name": "编辑计划", "perms": "insp:plan:update", "parent_perms": "insp:task:list", "sort": 6},
    {"name": "删除计划", "perms": "insp:plan:delete", "parent_perms": "insp:task:list", "sort": 7},
    # 权限管理
    {"name": "新增用户", "perms": "sys:user:create", "parent_perms": "sys:user:list", "sort": 1},
    {"name": "编辑用户", "perms": "sys:user:update", "parent_perms": "sys:user:list", "sort": 2},
    {"name": "删除用户", "perms": "sys:user:delete", "parent_perms": "sys:user:list", "sort": 3},
    {"name": "重置密码", "perms": "sys:user:reset-pwd", "parent_perms": "sys:user:list", "sort": 4},
    {"name": "分配角色", "perms": "sys:role:assign", "parent_perms": "sys:user:list", "sort": 5},
    {"name": "菜单管理", "perms": "sys:menu:manage", "parent_perms": "sys:user:list", "sort": 6},
    # 组织设置
    {"name": "新增组织", "perms": "sys:dept:create", "parent_perms": "sys:dept:list", "sort": 1},
    {"name": "编辑组织", "perms": "sys:dept:update", "parent_perms": "sys:dept:list", "sort": 2},
    {"name": "删除组织", "perms": "sys:dept:delete", "parent_perms": "sys:dept:list", "sort": 3},
    # 维修工单（补充）
    {"name": "人工报修", "perms": "repair:create", "parent_perms": "repair:list", "sort": 5},
    # 设备台账（补充：设备分类/生产厂商）
    {"name": "新增设备分类", "perms": "eq:type:create", "parent_perms": "eq:list", "sort": 5},
    {"name": "编辑设备分类", "perms": "eq:type:update", "parent_perms": "eq:list", "sort": 6},
    {"name": "删除设备分类", "perms": "eq:type:delete", "parent_perms": "eq:list", "sort": 7},
    {"name": "记录设备启停", "perms": "eq:run:event", "parent_perms": "eq:list", "sort": 8},
    # 厂商管理（补充：生产厂商）
    {"name": "新增生产厂商", "perms": "eq:mfr:create", "parent_perms": "eq:maintainer:list", "sort": 4},
    {"name": "编辑生产厂商", "perms": "eq:mfr:update", "parent_perms": "eq:maintainer:list", "sort": 5},
    {"name": "删除生产厂商", "perms": "eq:mfr:delete", "parent_perms": "eq:maintainer:list", "sort": 6},
    # 告警中心（补充：规则/类型）
    {"name": "新增告警规则", "perms": "alarm:rule:create", "parent_perms": "alarm:realtime", "sort": 5},
    {"name": "编辑告警规则", "perms": "alarm:rule:update", "parent_perms": "alarm:realtime", "sort": 6},
    {"name": "删除告警规则", "perms": "alarm:rule:delete", "parent_perms": "alarm:realtime", "sort": 7},
    {"name": "新增告警类型", "perms": "alarm:type:create", "parent_perms": "alarm:realtime", "sort": 8},
    {"name": "编辑告警类型", "perms": "alarm:type:update", "parent_perms": "alarm:realtime", "sort": 9},
    {"name": "删除告警类型", "perms": "alarm:type:delete", "parent_perms": "alarm:realtime", "sort": 10},
    # 设备维护（补充：维保记录）
    {"name": "临时维保", "perms": "maint:record:create", "parent_perms": "maint:plan:list", "sort": 4},
    {"name": "完成维保", "perms": "maint:record:complete", "parent_perms": "maint:plan:list", "sort": 5},
    {"name": "维保验收", "perms": "maint:record:accept", "parent_perms": "maint:plan:list", "sort": 6},
    # 供水统计
    {"name": "新增供水计划", "perms": "water:plan:create", "parent_perms": "water:stats", "sort": 1},
    {"name": "编辑供水计划", "perms": "water:plan:update", "parent_perms": "water:stats", "sort": 2},
    {"name": "删除供水计划", "perms": "water:plan:delete", "parent_perms": "water:stats", "sort": 3},
    # 耗能分析
    {"name": "新增耗能录入", "perms": "energy:record:create", "parent_perms": "energy:stats", "sort": 1},
    {"name": "编辑耗能录入", "perms": "energy:record:update", "parent_perms": "energy:stats", "sort": 2},
    {"name": "删除耗能录入", "perms": "energy:record:delete", "parent_perms": "energy:stats", "sort": 3},
    {"name": "新增电价", "perms": "energy:price:create", "parent_perms": "energy:stats", "sort": 4},
    {"name": "编辑电价", "perms": "energy:price:update", "parent_perms": "energy:stats", "sort": 5},
    {"name": "删除电价", "perms": "energy:price:delete", "parent_perms": "energy:stats", "sort": 6},
    # 实时监控
    {"name": "新增测点", "perms": "scada:point:create", "parent_perms": "scada:monitor", "sort": 1},
    {"name": "编辑测点", "perms": "scada:point:update", "parent_perms": "scada:monitor", "sort": 2},
    {"name": "测点注入", "perms": "scada:point:inject", "parent_perms": "scada:monitor", "sort": 3},
    {"name": "删除测点", "perms": "scada:point:delete", "parent_perms": "scada:monitor", "sort": 4},
    {"name": "仿真控制", "perms": "scada:sim:control", "parent_perms": "scada:monitor", "sort": 5},
    # 档案管理
    {"name": "上传档案", "perms": "archive:upload", "parent_perms": "archive:list", "sort": 1},
    {"name": "新增档案分类", "perms": "archive:category:create", "parent_perms": "archive:list", "sort": 2},
    {"name": "编辑档案分类", "perms": "archive:category:update", "parent_perms": "archive:list", "sort": 3},
    {"name": "删除档案分类", "perms": "archive:category:delete", "parent_perms": "archive:list", "sort": 4},
    {"name": "删除档案", "perms": "archive:delete", "parent_perms": "archive:list", "sort": 5},
    {"name": "下载档案", "perms": "archive:download", "parent_perms": "archive:list", "sort": 6},
    {"name": "编辑档案", "perms": "archive:update", "parent_perms": "archive:list", "sort": 7},
    # 设备维护（补充：派发/记录删除）
    {"name": "派发维保", "perms": "maint:plan:dispatch", "parent_perms": "maint:plan:list", "sort": 7},
    {"name": "删除维保记录", "perms": "maint:record:delete", "parent_perms": "maint:plan:list", "sort": 8},
    # 设备巡检（补充：认领）
    {"name": "认领巡检", "perms": "insp:task:claim", "parent_perms": "insp:task:list", "sort": 8},
]

# operator 角色默认分配的按钮权限码（执行 + 部分创建）
OPERATOR_BUTTON_PERMS = {
    "repair:process",        # 工单完工提交（仅本人被指派时）
    "repair:create",         # 人工报修（设备台账仅保留报修入口）
    "alarm:handle",          # 处理告警（仅本人被指派时）
    "insp:record:submit",    # 提交巡检记录
    "dispatch:create",       # 新建调度（需领导审核）
    "dispatch:execute",      # 执行完毕（角色界面矩阵 §5.1 补齐）
    "eq:run:event",          # 记录设备启停
    "maint:plan:create",     # 新增维保计划
    "maint:record:complete", # 完成维保（仅本人被指派的任务）
    "archive:download",      # 下载档案（角色界面矩阵 §5.1 补齐）
}

# 版本增量默认按钮：上线前种子里不存在，存量库中「缺失=从未授予」而非管理员手动取消，
# 由 _upsert_operator_button_perms 幂等追加（仅追加，不覆盖管理员已有配置）
OPERATOR_BUTTON_PERMS_INCREMENT = {"dispatch:execute", "archive:download"}

# 历史误授回收：早期种子误发给操作员的按钮（矩阵 §5.1 认定派发巡检属管理职能），
# 幂等移除；若管理员后来手动授予需重新在权限管理中勾选
OPERATOR_BUTTON_PERMS_REVOKE = {
    "insp:task:create",
    # 设备台账编辑/删除/新增属台账管理职能，操作员仅保留「报修」
    "eq:create",
    "eq:update",
    "eq:delete",
    # 派发维保属管理职能：操作员是被派活的执行方，不能给自己派活
    "maint:plan:dispatch",
}


def _upsert_buttons(db: Session) -> list[int]:
    """幂等插入按钮权限节点（按 perms 唯一）。

    对已有数据库（菜单已存在但按钮未灌入）兼容：按 perms 查找是否已存在，
    不存在则按 parent_perms 找父菜单后插入。
    """
    button_ids: list[int] = []
    for item in BUTTON_SEED:
        # 按 perms 查是否已存在按钮节点
        existing = (
            db.query(Menu)
            .filter(Menu.perms == item["perms"], Menu.menu_type == "button", Menu.deleted == 0)
            .first()
        )
        if existing:
            button_ids.append(existing.id)
            continue
        # 找父菜单
        parent = (
            db.query(Menu)
            .filter(Menu.perms == item["parent_perms"], Menu.deleted == 0)
            .first()
        )
        if not parent:
            # 父菜单不存在，跳过（菜单种子可能未包含该父菜单）
            continue
        menu = Menu(
            name=item["name"],
            path=None,
            component=None,
            icon=None,
            parent_id=parent.id,
            sort=item.get("sort", 0),
            menu_type="button",
            perms=item["perms"],
            visible=0,  # 按钮不在左侧菜单渲染
            status=1,
            deleted=0,
        )
        db.add(menu)
        db.flush()
        button_ids.append(menu.id)
    db.commit()
    return button_ids


def _upsert_audit_log_menu(db: Session, roles: dict[str, Role]) -> None:
    """幂等补入「操作日志」菜单（存量库兼容）。

    仅在首次插入菜单时给超管/领导授权；此后管理员在权限管理中的调整
    （包括取消授权）不再回灌，避免重启复活。
    """
    existing = (
        db.query(Menu)
        .filter(Menu.perms == "sys:log:list", Menu.menu_type == "menu")
        .first()
    )
    if existing:
        return

    parent = (
        db.query(Menu)
        .filter(Menu.name == "系统管理", Menu.menu_type == "directory", Menu.deleted == 0)
        .first()
    )
    if not parent:
        return

    menu = Menu(
        name="操作日志",
        path="/system/logs",
        component="system/logs",
        icon="ri:file-list-3-line",
        parent_id=parent.id,
        sort=3,
        menu_type="menu",
        perms="sys:log:list",
        visible=1,
        status=1,
        deleted=0,
    )
    db.add(menu)
    db.flush()

    for code in ("super_admin", "admin"):
        role = roles.get(code)
        if not role:
            continue
        db.add(RoleMenu(role_id=role.id, menu_id=menu.id))
    db.commit()


def _upsert_scada_menu(db: Session, roles: dict[str, Role]) -> None:
    """幂等补入「SCADA 接入」菜单（仅授权超管，存量库兼容）。"""
    existing = (
        db.query(Menu)
        .filter(Menu.perms == "sys:scada:config", Menu.menu_type == "menu")
        .first()
    )
    if existing:
        return

    parent = (
        db.query(Menu)
        .filter(Menu.name == "系统管理", Menu.menu_type == "directory", Menu.deleted == 0)
        .first()
    )
    if not parent:
        return

    menu = Menu(
        name="SCADA 接入",
        path="/system/scada",
        component="system/scada",
        icon="ri:link-line",
        parent_id=parent.id,
        sort=4,
        menu_type="menu",
        perms="sys:scada:config",
        visible=1,
        status=1,
        deleted=0,
    )
    db.add(menu)
    db.flush()

    role = roles.get("super_admin")
    if role:
        db.add(RoleMenu(role_id=role.id, menu_id=menu.id))
    db.commit()


def _upsert_dispatch_menu(db: Session, roles: dict[str, Role]) -> None:
    """幂等补入「调度指令」菜单并授权领导/操作员（存量库兼容）。

    dev 分支新增的一级菜单；存量库（菜单表非空）不会走 _seed_menus，
    此处按 perms 幂等补入。仅在首次插入时授权，此后管理员在权限管理中的
    调整（包括取消授权）不再回灌，避免重启复活。
    按钮节点由 _upsert_buttons 按 BUTTON_SEED 幂等补入（须保证本函数先执行），
    角色按钮授权由 LEADER/OPERATOR_BUTTON_PERMS_ENSURE 每次启动补齐。
    """
    existing = (
        db.query(Menu)
        .filter(Menu.perms == "dispatch:stats", Menu.menu_type == "menu")
        .first()
    )
    if existing:
        return

    menu = Menu(
        name="调度指令",
        path="/dispatch/stats",
        component="dispatch/stats",
        icon="ri:send-plane-line",
        parent_id=0,
        sort=6,
        menu_type="menu",
        perms="dispatch:stats",
        visible=1,
        status=1,
        deleted=0,
    )
    db.add(menu)
    db.flush()

    for code in ("admin", "operator"):
        role = roles.get(code)
        if role:
            db.add(RoleMenu(role_id=role.id, menu_id=menu.id))
    db.commit()


def seed_admin(db: Session) -> None:
    settings = get_settings()
    exists = (
        db.query(User)
        .filter(User.username == settings.bootstrap_admin_username)
        .first()
    )
    if not exists:
        admin = User(
            username=settings.bootstrap_admin_username,
            password_hash=hash_password(settings.bootstrap_admin_password),
            display_name=settings.bootstrap_admin_name,
            role_code="super_admin",
            status=1,
            deleted=0,
        )
        db.add(admin)
        db.commit()


def _seed_roles(db: Session) -> dict[str, Role]:
    role_defs = [
        ("超级管理员", "super_admin", "系统全部权限"),
        ("领导", "admin", "审批派发与验收"),
        ("操作员", "operator", "一线执行"),
    ]
    result: dict[str, Role] = {}
    for name, code, remark in role_defs:
        role = db.query(Role).filter(Role.code == code, Role.deleted == 0).first()
        if not role:
            role = Role(name=name, code=code, remark=remark, status=1, deleted=0)
            db.add(role)
            db.flush()
        result[code] = role
    # 数据范围种子：操作员=mine（仅本人数据）。存量库幂等回填；
    # 若管理员后续在角色管理中调整过，需同步修改此处常量，否则重启会被重置
    op = result.get("operator")
    if op and op.data_scope != "mine":
        op.data_scope = "mine"
    db.commit()
    return result


def _seed_menus(db: Session) -> list[int]:
    if db.query(Menu).filter(Menu.deleted == 0).count() > 0:
        return [m.id for m in db.query(Menu).filter(Menu.deleted == 0).all()]

    all_ids: list[int] = []

    def add_menu(item: dict, parent_id: int = 0) -> Menu:
        children = item.get("children") or []
        menu = Menu(
            name=item["name"],
            path=item.get("path"),
            component=item.get("component"),
            icon=item.get("icon"),
            parent_id=parent_id,
            sort=item.get("sort", 0),
            menu_type=item.get("menu_type", "menu" if not children else "directory"),
            perms=item.get("perms"),
            visible=1,
            status=1,
            deleted=0,
        )
        db.add(menu)
        db.flush()
        all_ids.append(menu.id)
        for child in children:
            add_menu(child, menu.id)
        return menu

    for item in MENU_SEED:
        add_menu(item)
    db.commit()
    return all_ids


def _seed_role_menus(db: Session, roles: dict[str, Role], menu_ids: list[int]) -> None:
    """分配菜单权限（不含按钮，按钮由 _upsert_operator_button_perms 单独管理）。

    注意：menu_ids 来自 _seed_menus，可能包含 button 类型节点，
    此处统一过滤掉 button，确保菜单分配和按钮分配职责分离。
    """
    if not menu_ids:
        return
    # 过滤掉 button 类型节点，按钮权限单独管理
    menu_only_ids = [
        mid
        for mid in menu_ids
        if db.query(Menu).filter(Menu.id == mid, Menu.menu_type != "button").first()
    ]

    # 角色界面矩阵终版（2026-10-20）：
    # super_admin 仅「系统管理」子树；领导/操作员排除「系统管理」；自定义角色默认全量
    menus = db.query(Menu).filter(Menu.deleted == 0).all()
    sys_ids = set()
    for m in menus:
        if m.name == "系统管理" or (
            m.parent_id
            and any(p.name == "系统管理" and p.id == m.parent_id for p in menus)
        ):
            sys_ids.add(m.id)
    # also children of 系统管理
    for m in menus:
        if m.parent_id in sys_ids:
            sys_ids.add(m.id)

    # 「操作日志」单独开给领导（系统管理子树内的只读审计页）
    log_ids = {m.id for m in menus if m.perms == "sys:log:list"}

    for code, role in roles.items():
        exists = db.query(RoleMenu).filter(RoleMenu.role_id == role.id).first()
        if exists:
            continue
        if code == "super_admin":
            assign_ids = [i for i in menu_only_ids if i in sys_ids]
        elif code == "admin":
            assign_ids = [i for i in menu_only_ids if i not in sys_ids or i in log_ids]
        elif code == "operator":
            assign_ids = [i for i in menu_only_ids if i not in sys_ids]
        else:
            assign_ids = menu_only_ids
        for mid in assign_ids:
            db.add(RoleMenu(role_id=role.id, menu_id=mid))
    db.commit()


def _upsert_operator_button_perms(db: Session, roles: dict[str, Role]) -> None:
    """给 leader 和 operator 角色做按钮权限的一次性种子。

    设计原则：
    - 按钮权限与菜单权限分离，由本函数统一管理
    - 一次性种子由 sys_role.perms_seeded 标记控制：仅「从未种子」时灌入默认集
      并置标记；此后管理员在权限管理界面的任何修改（包括清空）都被尊重，
      后端重启（含 --reload 频繁重启）不再回灌
    - 存量库迁移：已持有按钮关联的角色启动时自动置标记，视为已配置
    - super_admin 的 sys: 按钮由 _ensure_role_button_perms 每次启动补齐（只补不删）
    """
    all_buttons = (
        db.query(Menu)
        .filter(Menu.deleted == 0, Menu.menu_type == "button")
        .all()
    )
    button_ids = {m.id for m in all_buttons}

    def get_role_button_ids(role_id: int) -> set[int]:
        rms = (
            db.query(RoleMenu)
            .filter(RoleMenu.role_id == role_id, RoleMenu.menu_id.in_(button_ids))
            .all()
        )
        return {rm.menu_id for rm in rms}

    # 存量迁移：已持有任何按钮关联的角色视为「管理员已配置」，置 perms_seeded=1。
    # 必须放在默认集灌入之前——否则历史库（已有配置但标记为 0）会被误判为
    # 「从未种子」而回灌默认按钮，表现为「手动取消的权限在后端重启后复活」
    # （--reload 模式下 __pycache__/DB 写入都会频繁触发重启，放大该问题）
    for r in roles.values():
        if not r.perms_seeded and get_role_button_ids(r.id):
            r.perms_seeded = 1
    db.flush()

    # leader: 仅未完成一次性种子时灌入全部按钮。
    # 此后管理员的任何修改（含清空）都被尊重，不再回灌
    leader_role = roles.get("admin")
    if leader_role and not leader_role.perms_seeded:
        for m in all_buttons:
            db.add(RoleMenu(role_id=leader_role.id, menu_id=m.id))
        leader_role.perms_seeded = 1

    # operator: 仅未完成一次性种子时灌入默认执行类按钮（含版本增量项）
    op_role = roles.get("operator")
    if op_role:
        if not op_role.perms_seeded:
            default_perms = OPERATOR_BUTTON_PERMS | OPERATOR_BUTTON_PERMS_INCREMENT
            for m in all_buttons:
                if m.perms in default_perms:
                    db.add(RoleMenu(role_id=op_role.id, menu_id=m.id))
            op_role.perms_seeded = 1

        # 历史误授回收：幂等移除（属当前口径的纠偏，每次启动均执行）
        if OPERATOR_BUTTON_PERMS_REVOKE:
            revoke_ids = [
                m.id for m in all_buttons if m.perms in OPERATOR_BUTTON_PERMS_REVOKE
            ]
            if revoke_ids:
                db.query(RoleMenu).filter(
                    RoleMenu.role_id == op_role.id,
                    RoleMenu.menu_id.in_(revoke_ids),
                ).delete(synchronize_session=False)

    db.commit()


# 版本增量授权（每次启动幂等 ensure，只补不删）：
# 新增权限码在存量库「缺失=从未授予」，不存在覆盖管理员手工配置的风险；
# 旧码调整一律走 REVOKE/人工，不在此回灌
LEADER_BUTTON_PERMS_ENSURE = {
    "archive:update",
    "maint:plan:dispatch",
    "maint:record:delete",
    "insp:task:claim",
    # 调度指令为 dev 新增模块：5 个权限码在存量库「缺失=从未授予」，补授安全
    "dispatch:audit",  # 审核调度（存量库幂等补授，新库由一次性全量种子覆盖）
    "dispatch:create",
    "dispatch:update",
    "dispatch:delete",
    "dispatch:execute",
}
OPERATOR_BUTTON_PERMS_ENSURE = {
    "insp:task:claim",  # 认领巡检任务
    "repair:create",    # 巡检异常发起工单 / 人工报修
    # 调度指令为 dev 新增模块：按角色矩阵操作员持新建/执行（存量库缺失=从未授予）
    "dispatch:create",
    "dispatch:execute",
}


def _ensure_role_button_perms(db: Session, roles: dict[str, Role]) -> None:
    """每次启动幂等补授按钮权限（只补不删）。

    - super_admin：全量 sys: 前缀按钮（「超管=系统管理」硬不变量，
      通配符移除后超管按实际授权校验，系统管理写接口依赖此项）
    - 领导/操作员：补授版本新增码（存量库缺失=从未授予，安全）
    """
    all_buttons = (
        db.query(Menu)
        .filter(Menu.deleted == 0, Menu.menu_type == "button")
        .all()
    )

    def ensure(role: Role | None, menu_ids: set[int]) -> None:
        if not role or not menu_ids:
            return
        existing = {
            rm.menu_id
            for rm in db.query(RoleMenu)
            .filter(RoleMenu.role_id == role.id, RoleMenu.menu_id.in_(menu_ids))
            .all()
        }
        for mid in menu_ids - existing:
            db.add(RoleMenu(role_id=role.id, menu_id=mid))

    ensure(
        roles.get("super_admin"),
        {m.id for m in all_buttons if m.perms and m.perms.startswith("sys:")},
    )
    ensure(
        roles.get("admin"),
        {m.id for m in all_buttons if m.perms in LEADER_BUTTON_PERMS_ENSURE},
    )
    ensure(
        roles.get("operator"),
        {m.id for m in all_buttons if m.perms in OPERATOR_BUTTON_PERMS_ENSURE},
    )

    # 边界回收：「系统管理」为超管专属域，领导/操作员不应持有其菜单与按钮。
    # 历史种子曾给领导灌入全部按钮（sys:user:* 等）及系统管理菜单节点，
    # 与角色界面矩阵（领导=业务全部+操作日志）矛盾，属误授，每次启动幂等回收。
    # 「操作日志」（sys:log:list）是明确授予领导的审计页，保留
    all_menus = db.query(Menu).filter(Menu.deleted == 0).all()
    log_menu_ids = {m.id for m in all_menus if m.perms == "sys:log:list"}
    sys_ids = set()
    for m in all_menus:
        if m.name == "系统管理" or (
            m.parent_id
            and any(p.name == "系统管理" and p.id == m.parent_id for p in all_menus)
        ):
            sys_ids.add(m.id)
    for m in all_menus:
        if m.parent_id in sys_ids:
            sys_ids.add(m.id)
    sys_button_ids = {m.id for m in all_buttons if m.perms and m.perms.startswith("sys:")}
    revoke_ids = (sys_ids | sys_button_ids) - log_menu_ids
    if revoke_ids:
        for code in ("admin", "operator"):
            role = roles.get(code)
            if role:
                db.query(RoleMenu).filter(
                    RoleMenu.role_id == role.id,
                    RoleMenu.menu_id.in_(revoke_ids),
                ).delete(synchronize_session=False)
    db.commit()


def _seed_equipment_types(db: Session) -> None:
    if db.query(EquipmentType).filter(EquipmentType.deleted == 0).count() > 0:
        return
    for name, code, desc in DEFAULT_TYPES:
        db.add(
            EquipmentType(
                name=name,
                code=code,
                description=desc,
                status=1,
                deleted=0,
            )
        )
    db.commit()


def _seed_org_sample(db: Session) -> None:
    if db.query(Department).filter(Department.deleted == 0).count() == 0:
        db.add(
            Department(
                name="运行部",
                code="OPS",
                remark="生产运行",
                status=1,
                deleted=0,
            )
        )
        db.add(
            Department(
                name="设备部",
                code="EQ",
                remark="设备管理",
                status=1,
                deleted=0,
            )
        )
        db.commit()

    if db.query(Location).filter(Location.deleted == 0).count() == 0:
        db.add(
            Location(
                name="一号泵房",
                code="LOC-P1",
                remark="主泵房",
                status=1,
                deleted=0,
            )
        )
        db.add(
            Location(
                name="中控室",
                code="LOC-CTRL",
                remark="",
                status=1,
                deleted=0,
            )
        )
        db.commit()


def _bind_admin_role(db: Session, roles: dict[str, Role]) -> None:
    settings = get_settings()
    admin = (
        db.query(User)
        .filter(User.username == settings.bootstrap_admin_username, User.deleted == 0)
        .first()
    )
    if not admin:
        return
    super_role = roles.get("super_admin")
    if not super_role:
        return
    exists = (
        db.query(UserRole)
        .filter(UserRole.user_id == admin.id, UserRole.role_id == super_role.id)
        .first()
    )
    if not exists:
        db.add(UserRole(user_id=admin.id, role_id=super_role.id))
        db.commit()


DEFAULT_SCADA_POINTS = [
    # 对齐旧 scada-data-sync 示例点
    {
        "tag_name": "PLC1.Flow",
        "node_id": "ns=1;i=686",
        "value_type": "number",
        "unit": "m³/h",
        "description": "1# 流量",
        "sim_base": 120,
        "sim_amplitude": 15,
        "sim_period_sec": 30,
    },
    {
        "tag_name": "PLC2.Flow",
        "node_id": "ns=1;i=681",
        "value_type": "number",
        "unit": "m³/h",
        "description": "2# 流量",
        "sim_base": 100,
        "sim_amplitude": 12,
        "sim_period_sec": 40,
    },
    # 常用告警/设备联调用点（数字 id 便于设备绑定）
    {
        "tag_name": "700",
        "node_id": "ns=1;i=700",
        "value_type": "number",
        "unit": "℃",
        "description": "1#泵轴承温度",
        "sim_base": 55,
        "sim_amplitude": 8,
        "sim_period_sec": 25,
    },
    {
        "tag_name": "701",
        "node_id": "ns=1;i=701",
        "value_type": "number",
        "unit": "A",
        "description": "1#泵电流",
        "sim_base": 80,
        "sim_amplitude": 10,
        "sim_period_sec": 20,
    },
    {
        "tag_name": "702",
        "node_id": "ns=1;i=702",
        "value_type": "bool",
        "unit": "",
        "description": "1#泵运行状态",
        "sim_base": 0.5,
        "sim_amplitude": 1,
        "sim_period_sec": 50,
    },
    {
        "tag_name": "703",
        "node_id": "ns=1;i=703",
        "value_type": "number",
        "unit": "m",
        "description": "前池液位",
        "sim_base": 3.2,
        "sim_amplitude": 0.4,
        "sim_period_sec": 60,
    },
    {
        "tag_name": "Gate1_Status",
        "node_id": "ns=1;s=Gate1_Status",
        "value_type": "bool",
        "unit": "",
        "description": "1#闸门状态",
        "sim_base": 0.5,
        "sim_amplitude": 1,
        "sim_period_sec": 80,
    },
    {
        "tag_name": "Gate1_Opening",
        "node_id": "ns=1;s=Gate1_Opening",
        "value_type": "number",
        "unit": "%",
        "description": "1#闸门开度",
        "sim_base": 40,
        "sim_amplitude": 20,
        "sim_period_sec": 90,
    },
]


def _seed_scada_points(db: Session) -> None:
    if db.query(ScadaPoint).filter(ScadaPoint.deleted == 0).count() > 0:
        return
    for item in DEFAULT_SCADA_POINTS:
        db.add(
            ScadaPoint(
                **item,
                enabled=1,
                status=1,
                deleted=0,
            )
        )
    db.commit()


DEFAULT_ALARM_TYPES = [
    ("温度告警", "TEMP_ALERT", "温度超限告警"),
    ("离散故障告警", "FAULT_ALERT", "故障位=1触发"),
    ("通信告警", "COMM_ALERT", "通讯中断告警"),
    ("液位告警", "LEVEL_ALERT", "液位超限告警"),
    ("电气告警", "ELEC_ALERT", "电气保护动作告警"),
    ("运行状态告警", "STATUS_ALERT", "运行状态异常变化"),
]


def _seed_alarm_types(db: Session) -> None:
    if db.query(AlarmType).filter(AlarmType.deleted == 0).count() > 0:
        return
    for name, code, desc in DEFAULT_ALARM_TYPES:
        db.add(
            AlarmType(
                name=name,
                code=code,
                description=desc,
                status=1,
                deleted=0,
            )
        )
    db.commit()


def _seed_electricity_price(db: Session) -> None:
    if db.query(ElectricityPrice).filter(ElectricityPrice.deleted == 0).count() > 0:
        return
    db.add(
        ElectricityPrice(
            name="默认峰谷平电价",
            peak_price=Decimal("1.2000"),
            valley_price=Decimal("0.3500"),
            normal_price=Decimal("0.7000"),
            peak_hours="8,9,10,18,19,20",
            valley_hours="0,1,2,3,4,5,23",
            effective_from=date(2024, 1, 1),
            effective_to=None,
            remark="系统预置",
            status=1,
            deleted=0,
        )
    )
    db.commit()


# 档案分类目录种子（层级：组 + 子类；count 为分类自身维护的计数，对齐设计稿）
ARCHIVE_CATEGORY_SEED = [
    {
        "name": "运维记录",
        "count": 240,
        "sort": 1,
        "children": [
            {"name": "告警关联工单", "code": "DOC-ORDER-ALARM", "count": 68},
            {"name": "巡检关联工单", "code": "DOC-ORDER-INSPECTION", "count": 72},
            {"name": "维保关联工单", "code": "DOC-ORDER-MAINTENANCE", "count": 54},
            {"name": "人工创建工单", "code": "DOC-ORDER-MANUAL", "count": 46},
        ],
    },
    {
        "name": "设备资料",
        "count": 42,
        "sort": 2,
        "children": [
            {"name": "设备说明书", "code": "DOC-EQ-MANUAL", "count": 18},
            {"name": "设备图纸", "code": "DOC-DRAWING", "count": 12},
            {"name": "设备技术参数", "code": "DOC-EQ-SPEC", "count": 12},
        ],
    },
    {
        "name": "技术资料",
        "count": 28,
        "sort": 3,
        "children": [
            {"name": "技术规范", "code": "DOC-STANDARD", "count": 10},
            {"name": "技术方案", "code": "DOC-TECH-PLAN", "count": 8},
            {"name": "维护手册", "code": "DOC-MAINT-MANUAL", "count": 10},
        ],
    },
    {
        "name": "合同文件",
        "count": 18,
        "sort": 4,
        "children": [
            {"name": "采购合同", "code": "DOC-CONTRACT-PURCHASE", "count": 10},
            {"name": "服务协议", "code": "DOC-CONTRACT-SERVICE", "count": 8},
        ],
    },
    {"name": "其他资料", "code": "DOC-OTHER", "count": 32, "sort": 5},
]


def _seed_archive_categories(db: Session) -> None:
    """幂等同步档案分类：首次建库时全量插入；后续按种子结构补齐/修正。
    - 按 name 匹配顶层组，按 code 匹配子分类；
    - 已存在的更新 name/sort/count；
    - 种子中不存在的旧分类软删除（如旧的「工单档案」顶层组与旧「运维记录」子类）。
    """
    existing = (
        db.query(ArchiveCategory)
        .filter(ArchiveCategory.deleted == 0)
        .all()
    )
    if not existing:
        # 首次建库：直接全量插入
        for group in ARCHIVE_CATEGORY_SEED:
            parent = ArchiveCategory(
                name=group["name"],
                code=group.get("code"),
                parent_id=0,
                count=group["count"],
                sort=group["sort"],
                status=1,
                deleted=0,
            )
            db.add(parent)
            db.flush()
            for index, child in enumerate(group.get("children", []), start=1):
                db.add(
                    ArchiveCategory(
                        name=child["name"],
                        code=child.get("code"),
                        parent_id=parent.id,
                        count=child["count"],
                        sort=index,
                        status=1,
                        deleted=0,
                    )
                )
        db.commit()
        return

    # 存量库：按种子同步
    by_name = {c.name: c for c in existing if c.parent_id == 0}
    by_code = {c.code: c for c in existing if c.code}

    seed_leaf_codes = set()
    seed_top_names = set()

    for group in ARCHIVE_CATEGORY_SEED:
        seed_top_names.add(group["name"])
        parent = by_name.get(group["name"])
        if parent:
            parent.sort = group["sort"]
            parent.count = group["count"]
            parent.code = group.get("code")
        else:
            parent = ArchiveCategory(
                name=group["name"],
                code=group.get("code"),
                parent_id=0,
                count=group["count"],
                sort=group["sort"],
                status=1,
                deleted=0,
            )
            db.add(parent)
            db.flush()

        for index, child in enumerate(group.get("children", []), start=1):
            seed_leaf_codes.add(child.get("code"))
            node = by_code.get(child.get("code"))
            if node:
                node.name = child["name"]
                node.parent_id = parent.id
                node.count = child["count"]
                node.sort = index
            else:
                db.add(
                    ArchiveCategory(
                        name=child["name"],
                        code=child.get("code"),
                        parent_id=parent.id,
                        count=child["count"],
                        sort=index,
                        status=1,
                        deleted=0,
                    )
                )

    # 软删除种子中不再存在的旧分类（顶层组按 name，子分类按 code）
    for c in existing:
        if c.parent_id == 0:
            if c.name not in seed_top_names:
                c.deleted = 1
        else:
            if c.code and c.code not in seed_leaf_codes:
                c.deleted = 1

    db.commit()


# 工单来源 → 档案子分类码映射（与 repair_service 保持一致）
_REPAIR_SOURCE_TO_ARCHIVE_CODE = {
    "alarm": "DOC-ORDER-ALARM",
    "inspection": "DOC-ORDER-INSPECTION",
    "manual": "DOC-ORDER-MANUAL",
    "maintenance": "DOC-ORDER-MAINTENANCE",
}


def _backfill_archive_from_archived_repairs(db: Session) -> None:
    """为存量已归档工单补齐档案记录（幂等：已存在 related_order 的跳过）。
    确保「运维记录」分类下能展示历史工单数据。"""
    archived = (
        db.query(RepairOrder)
        .filter(RepairOrder.deleted == 0, RepairOrder.process_status == "archived")
        .all()
    )
    if not archived:
        return
    # 已建档案的工单号集合
    existing_order_nos = {
        r[0]
        for r in db.query(Archive.related_order)
        .filter(Archive.deleted == 0, Archive.related_order.isnot(None))
        .all()
    }
    # 分类码 → 分类名 映射
    cat_map = {
        c.code: c.name
        for c in db.query(ArchiveCategory).filter(ArchiveCategory.deleted == 0).all()
        if c.code
    }

    day = datetime.now().strftime("%Y%m%d")
    seq = db.query(Archive.id).count()
    for order in archived:
        if order.order_no in existing_order_nos:
            continue
        seq += 1
        category_code = _REPAIR_SOURCE_TO_ARCHIVE_CODE.get(order.source, "DOC-ORDER-MANUAL")
        desc_parts = [order.description or ""]
        if order.process_feedback:
            desc_parts.append(f"维修反馈：{order.process_feedback}")
        if order.accept_comment:
            desc_parts.append(f"验收意见：{order.accept_comment}")
        description = "\n".join(p for p in desc_parts if p)
        db.add(
            Archive(
                name=order.name or f"{order.equipment_name or ''}维修档案",
                category_code=category_code,
                category_name=cat_map.get(category_code, "运维记录"),
                file_path="",
                file_name=f"{order.order_no}.pdf",
                file_size=0,
                file_format="pdf",
                uploader_name=order.acceptor_name or "系统",
                description=description,
                download_count=0,
                status=1,
                deleted=0,
                archive_no=f"DA{day}{seq:03d}",
                source="自动关联",
                related_order=order.order_no,
                related_equipment=order.equipment_name,
                related_matter=f"工单验收归档（{order.order_no}）",
            )
        )
    db.commit()


def seed_all(db: Session) -> None:
    seed_admin(db)
    roles = _seed_roles(db)
    menu_ids = _seed_menus(db)
    _seed_role_menus(db, roles, menu_ids)
    # 存量库补入「调度指令」菜单并授权领导/操作员（幂等，须先于 _upsert_buttons，
    # 否则调度按钮因父菜单不存在被跳过）
    _upsert_dispatch_menu(db, roles)
    # 灌入按钮权限节点（幂等，兼容已有菜单库）
    _upsert_buttons(db)
    # 存量库补入「操作日志」菜单并授权超管/领导（幂等）
    _upsert_audit_log_menu(db, roles)
    # 存量库补入「SCADA 接入」菜单并仅授权超管（幂等）
    _upsert_scada_menu(db, roles)
    # 给 operator 角色补齐执行+部分创建类按钮权限（幂等）
    _upsert_operator_button_perms(db, roles)
    # 超管 sys: 按钮 + 领导/操作员版本新增码，每次启动幂等补授（只补不删）
    _ensure_role_button_perms(db, roles)
    # 注意：旧版此处的 _ensure_menu_group 补丁会按名字复活已软删除的旧目录
    # （告警管理/维修工单目录/SCADA采集/供水统计/耗能分析等），已随 2026-10-04
    # 菜单扁平化改造全部移除；菜单结构唯一事实来源为上方 MENU_SEED。
    _seed_equipment_types(db)
    _seed_org_sample(db)
    _seed_scada_points(db)
    _seed_alarm_types(db)
    _seed_electricity_price(db)
    _seed_archive_categories(db)
    # 存量已归档工单补齐档案记录（幂等）
    _backfill_archive_from_archived_repairs(db)
    _bind_admin_role(db, roles)
