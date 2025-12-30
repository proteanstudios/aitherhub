from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
import logging

from app.core.db import get_db
from app.repository.auth_repo import get_user_by_id
from app.utils.jwt import decode_token
from jose import JWTError

logger = logging.getLogger(__name__)

security = HTTPBearer(auto_error=False)


async def get_current_user_async(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Optional[dict]:
    """
    Dependency to get current user from JWT token (async version for old routers)
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = credentials.credentials
    
    try:
        payload = decode_token(token)
        user_id = payload.get("sub")
        
        if not user_id:
            logger.warning("Token missing 'sub' field")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing user id",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        user = await get_user_by_id(db, user_id)
        
        if not user:
            logger.warning(f"User not found for id: {user_id}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        return {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role,
            "is_active": user.is_active,
        }
    except JWTError as e:
        logger.error(f"JWT decode error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in get_current_user: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )

# Alias for backward compatibility
get_current_user = get_current_user_async


# Dependency injection pattern functions (commented out until BaseRepository/BaseService are implemented)
# from dependency_injector.wiring import Provide, inject
# from fastapi import Depends
# from jose import jwt
# from pydantic import ValidationError

# from app.core.config import configs
# from app.core.container import Container
# from app.core.exceptions import AuthError
# from app.core.security import ALGORITHM, JWTBearer
# from app.model.user import User
# from app.schema.auth_schema import Payload
# from app.services.user_service import UserService


# @inject
# def get_current_user(
#     token: str = Depends(JWTBearer()),
#     service: UserService = Depends(Provide[Container.user_service]),
# ) -> User:
#     try:
#         payload = jwt.decode(token, configs.SECRET_KEY, algorithms=ALGORITHM)
#         token_data = Payload(**payload)
#     except (jwt.JWTError, ValidationError):
#         raise AuthError(detail="Could not validate credentials")
#     current_user: User = service.get_by_id(token_data.id)
#     if not current_user:
#         raise AuthError(detail="User not found")
#     return current_user


# def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
#     if not current_user.is_active:
#         raise AuthError("Inactive user")
#     return current_user


# def get_current_user_with_no_exception(
#     token: str = Depends(JWTBearer()),
#     service: UserService = Depends(Provide[Container.user_service]),
# ) -> User:
#     try:
#         payload = jwt.decode(token, configs.SECRET_KEY, algorithms=ALGORITHM)
#         token_data = Payload(**payload)
#     except (jwt.JWTError, ValidationError):
#         return None
#     current_user: User = service.get_by_id(token_data.id)
#     if not current_user:
#         return None
#     return current_user


# def get_current_super_user(current_user: User = Depends(get_current_user)) -> User:
#     if not current_user.is_active:
#         raise AuthError("Inactive user")
#     if not current_user.is_superuser:
#         raise AuthError("It's not a super user")
#     return current_user

# Placeholder functions to prevent import errors
# These will be implemented when BaseRepository/BaseService are available
def get_current_active_user(*args, **kwargs):
    """Placeholder - to be implemented"""
    pass

def get_current_super_user(*args, **kwargs):
    """Placeholder - to be implemented"""
    pass
