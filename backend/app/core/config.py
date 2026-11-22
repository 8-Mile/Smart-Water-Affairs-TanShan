from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# 出厂默认值，仅用于开发/演示；生产环境必须通过环境变量覆盖
INSECURE_DEFAULT_JWT_SECRET = "dev-secret-change-me"
INSECURE_DEFAULT_ADMIN_PASSWORD = "admin123"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "生产运维管理系统"
    app_env: str = "dev"
    debug: bool = True
    api_v1_prefix: str = "/api/v1"

    jwt_secret: str = INSECURE_DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    database_url: str = "sqlite:///./water_ops.db"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    bootstrap_admin_username: str = "admin"
    bootstrap_admin_password: str = INSECURE_DEFAULT_ADMIN_PASSWORD
    bootstrap_admin_name: str = "系统管理员"

    # SCADA
    # mock = 主站内置仿真；gateway = 使用 scada-gateway 推送镜像；opcua 预留
    scada_mode: str = "mock"
    scada_auto_start: bool = True
    scada_sim_interval_sec: float = 1.0
    scada_opcua_endpoint: str = "opc.tcp://192.168.2.222:9433"
    scada_opcua_security_policy: str = "None"
    scada_opcua_auth_mode: str = "anonymous"
    scada_opcua_username: str = ""
    scada_opcua_password: str = ""
    # 独立 Gateway（阶段 2+）
    scada_gateway_url: str = "http://127.0.0.1:8100"
    scada_gateway_api_prefix: str = "/api/v1"
    scada_gateway_token: str = "dev-scada-gateway-token-change-me"
    # 接收 Gateway webhook 的 token；空则回退 scada_gateway_token
    scada_ingest_token: str = ""
    # latest/history 数据源：mirror=读主站镜像表（默认）；gateway=透传 Gateway
    scada_data_source: str = "mirror"

    # 本地 AI（阶段 4+）
    ai_enabled: bool = True
    # Explicitly opt-in, development-only. Never activates in production.
    ai_mock_enabled: bool = False
    ai_service_url: str = "http://127.0.0.1:8200"
    ai_service_api_prefix: str = "/api/v1"
    ai_service_token: str = "dev-ai-service-token-change-me"
    # 与 ai-service 拉取档案 internal 接口共用；默认回退 ai_service_token
    ai_internal_token: str = ""
    ai_timeout_sec: float = 120.0
    # 上传档案后异步通知 ai-service 建索引
    ai_rag_index_on_upload: bool = True

    # 上传与安全（Phase 9/10）
    upload_dir: str = "./uploads"
    upload_max_mb: int = 50
    # 生产环境建议 false，关闭 /docs
    enable_docs: bool = True
    # 登录限流：窗口秒数 / 最大次数
    login_rate_limit_window_sec: int = 300
    login_rate_limit_max: int = 20
    # 写操作审计
    enable_audit_log: bool = True
    # 系统操作日志保留天数（<=0 表示不清理）
    audit_log_retention_days: int = 180

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_prod(self) -> bool:
        return self.app_env.lower() in ("prod", "production")

    @property
    def insecure_defaults(self) -> list[str]:
        """返回仍在使用出厂默认值的安全敏感配置项名称。"""
        issues: list[str] = []
        if self.jwt_secret.strip() == INSECURE_DEFAULT_JWT_SECRET:
            issues.append("JWT_SECRET")
        if self.bootstrap_admin_password.strip() == INSECURE_DEFAULT_ADMIN_PASSWORD:
            issues.append("BOOTSTRAP_ADMIN_PASSWORD")
        return issues


@lru_cache
def get_settings() -> Settings:
    return Settings()
