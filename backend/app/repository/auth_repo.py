# app/repository/auth_repo.py

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.orm.user import User
from app.utils.password import verify_password, hash_password


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(
        select(User).where(User.email == email)
    )
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: str | int) -> User | None:
    try:
        # Convert to int if it's a string
        user_id_int = int(user_id) if isinstance(user_id, str) else user_id
    except (ValueError, TypeError):
        return None
    
    result = await db.execute(
        select(User).where(User.id == user_id_int)
    )
    return result.scalar_one_or_none()


async def verify_user_password(
    db: AsyncSession,
    email: str,
    password: str,
) -> bool:
    user = await get_user_by_email(db, email)
    if not user:
        return False

    return verify_password(password, user.hashed_password)


async def create_user_with_password(
    db: AsyncSession,
    email: str,
    password: str,
) -> User:
    user = User(
        email=email,
        hashed_password=hash_password(password),
    )

    db.add(user)
    await db.commit()
    await db.refresh(user)

    return user


async def update_user_password(
    db: AsyncSession,
    user_id: str | int,
    new_password: str,
) -> User:
    try:
        # Convert to int if it's a string
        user_id_int = int(user_id) if isinstance(user_id, str) else user_id
    except (ValueError, TypeError):
        raise ValueError("Invalid user ID")
    
    user = await get_user_by_id(db, user_id_int)
    if not user:
        raise ValueError("User not found")
    
    user.hashed_password = hash_password(new_password)
    await db.commit()
    await db.refresh(user)
    
    return user
