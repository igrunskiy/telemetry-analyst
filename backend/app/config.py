from pydantic_settings import BaseSettings
from pydantic import field_validator
from typing import List


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    GARAGE61_CLIENT_ID: str
    GARAGE61_CLIENT_SECRET: str
    GARAGE61_REDIRECT_URI: str = "http://localhost:8000/auth/callback"
    GARAGE61_AUTH_URL: str = "https://garage61.net/app/account/oauth"
    GARAGE61_TOKEN_URL: str = "https://garage61.net/api/oauth/token"
    GARAGE61_API_BASE: str = "https://garage61.net/api/v1"
    CLAUDE_API_KEY: str = ""
    ENCRYPTION_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 168  # 1 week
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
