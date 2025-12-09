# app/models/orm/user.py
from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class User(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    provider: Mapped[str]
    provider_user_id: Mapped[str]
    display_name: Mapped[str | None]
    avatar_url: Mapped[str | None]
    role: Mapped[str] = mapped_column(default="user")
