from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "SCADA Gateway"
    app_env: str = "dev"
    api_v1_prefix: str = "/api/v1"

    gateway_token: str = "dev-scada-gateway-token-change-me"
    database_url: str = "sqlite:///./scada_hub.db"

    source_mode: str = "mock"  # mock | opcua
    auto_start: bool = True
    sim_interval_sec: float = 1.0
    retention_days: int = 90
    # 历史清理检查间隔（秒），默认 1 小时
    retention_interval_sec: float = 3600.0

    main_app_webhook_url: str = ""
    main_app_webhook_token: str = ""

    opcua_endpoint: str = "opc.tcp://192.168.2.222:9433"
    # None | Basic256Sha256 等（需证书时配合 CERT/KEY）
    opcua_security_policy: str = "None"
    # anonymous | user
    opcua_auth_mode: str = "anonymous"
    opcua_username: str = ""
    opcua_password: str = ""
    opcua_cert_path: str = ""
    opcua_key_path: str = ""
    opcua_timeout_sec: float = 10.0
    # 订阅发布周期 ms
    opcua_subscription_period_ms: int = 500
    # 轮询兜底间隔（秒）
    opcua_poll_interval_sec: float = 2.0
    # 断线后首次重连等待（秒，随后指数退避至 60s）
    opcua_reconnect_sec: float = 3.0
    # 是否允许 inject 写回 OPC 节点
    opcua_allow_write: bool = False

    host: str = "0.0.0.0"
    port: int = 8100


@lru_cache
def get_settings() -> Settings:
    return Settings()
