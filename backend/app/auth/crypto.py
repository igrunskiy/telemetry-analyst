from cryptography.fernet import Fernet
from app.config import settings


def _get_fernet() -> Fernet:
    key = settings.ENCRYPTION_KEY
    # Ensure the key is proper bytes for Fernet
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encrypt(value: str) -> str:
    """Encrypt a plain string and return base64-encoded ciphertext."""
    f = _get_fernet()
    return f.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    """Decrypt a base64-encoded ciphertext and return the plain string."""
    f = _get_fernet()
    return f.decrypt(value.encode()).decode()
