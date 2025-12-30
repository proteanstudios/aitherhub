from dependency_injector import containers, providers

from app.core.config import configs
from app.core.database import Database

# Note: Repository and Service classes require BaseRepository and BaseService
# which are not yet implemented. These are commented out until fully implemented.
# from app.repository import *
# from app.services import *


class Container(containers.DeclarativeContainer):
    wiring_config = containers.WiringConfiguration(
        modules=[
            # Only wire modules that use dependency injection
            # All endpoints are using async pattern, no wiring needed
        ]
    )

    db = providers.Singleton(Database, db_url=configs.DATABASE_URI)

    # Commented out until BaseRepository and BaseService are implemented
    # user_repository = providers.Factory(UserRepository, session_factory=db.provided.session)
    # auth_service = providers.Factory(AuthService, user_repository=user_repository)
    # user_service = providers.Factory(UserService, user_repository=user_repository)
