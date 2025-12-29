from sqlalchemy import Text, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.models.orm.base import Base, UUIDMixin, TimestampMixin


class Credential(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "credentials"

    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
