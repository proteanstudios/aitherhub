from passlib.context import CryptContext
import hashlib

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)

def hash_password(password: str) -> str:
    password_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return pwd_context.hash(password_hash)

def verify_password(password: str, hashed: str) -> bool:
    password_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
    return pwd_context.verify(password_hash, hashed)