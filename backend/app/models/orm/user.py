# app/models/orm/user.py
from sqlalchemy import (
    Text,
    String,
    Boolean,
    CheckConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, IntegerMixin, TimestampMixin


class User(Base, IntegerMixin, TimestampMixin):
    __tablename__ = "users"

    __table_args__ = (
        CheckConstraint(
            "(provider = 'local' AND hashed_password IS NOT NULL) OR "
            "(provider != 'local' AND provider_user_id IS NOT NULL)",
            name="ck_user_auth_provider",
        ),
    )

    email: Mapped[str] = mapped_column(
        Text,
        unique=True,
        index=True,
        nullable=False,
    )

    hashed_password: Mapped[str | None] = mapped_column(nullable=True)

    provider: Mapped[str] = mapped_column(
        String(50),
        default="local",
        index=True,
        nullable=False,
    )

    provider_user_id: Mapped[str | None] = mapped_column(Text)

    display_name: Mapped[str | None] = mapped_column(String(255))

    avatar_url: Mapped[str | None] = mapped_column(Text)

    role: Mapped[str] = mapped_column(
        String(50),
        default="user",
        index=True,
        nullable=False,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    # LCJ連携
    lcj_liver_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    lcj_liver_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lcj_linked_at: Mapped[str | None] = mapped_column(String(50), nullable=True)
