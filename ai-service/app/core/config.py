from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "AI Service"
    app_env: str = "dev"
    api_v1_prefix: str = "/api/v1"
    host: str = "0.0.0.0"
    port: int = 8200

    ai_service_token: str = "dev-ai-service-token-change-me"

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_chat_model: str = "qwen2.5:7b"
    ollama_embed_model: str = "nomic-embed-text"
    ollama_timeout_sec: float = 120.0
    ai_temperature: float = 0.2
    ai_system_prompt: str = (
        "你是生产运维管理系统的本地智能助手。用简洁中文回答。"
        "业务数据必须通过工具查询，禁止编造。"
    )

    # 主业务系统（Tools 用用户 JWT 调用）
    main_app_url: str = "http://127.0.0.1:8000"
    main_app_api_prefix: str = "/api/v1"
    main_app_timeout_sec: float = 30.0
    # 主站 internal 档案接口 Token（可与 AI_SERVICE_TOKEN 相同）
    main_app_internal_token: str = ""
    ai_tools_enabled: bool = True
    ai_max_tool_rounds: int = 6
    # 高风险：允许 AI 挂起 SCADA 注入（仍需用户确认）
    ai_allow_scada_inject: bool = False
    # 限流：每用户每窗口最大对话次数
    ai_rate_limit_max: int = 20
    ai_rate_limit_window_sec: int = 60

    # RAG
    rag_store_path: str = "./data/rag_index.jsonl"
    rag_chunk_size: int = 600
    rag_chunk_overlap: int = 80
    rag_top_k: int = 5
    rag_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
