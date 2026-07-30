import os
from functools import lru_cache


class Settings:
    """Runtime configuration for the Iberia platform backend."""

    app_name: str = "Iberia Digital Platform"
    env: str = os.getenv("IBERIA_ENV", "local")
    database_url: str = os.getenv("IBERIA_DATABASE_URL", "sqlite:///./iberia.db")
    jwt_secret: str = os.getenv("IBERIA_JWT_SECRET", "iberia-local-dev-secret")
    jwt_algorithm: str = "HS256"
    jwt_ttl_minutes: int = int(os.getenv("IBERIA_JWT_TTL_MINUTES", "720"))
    log_level: str = os.getenv("IBERIA_LOG_LEVEL", "INFO")
    cors_origins: list[str] = os.getenv(
        "IBERIA_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
