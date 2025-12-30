# Backend Architecture

## Structure

```
backend/
├── app/
│   ├── api/
│   │   └── v1/
│   │       ├── endpoints/
│   │       │   ├── __init__.py
│   │       │   └── video.py           # Video endpoints
│   │       ├── __init__.py
│   │       └── routes.py               # v1 router aggregator
│   ├── schema/
│   │   ├── __init__.py
│   │   ├── base_schema.py             # Base response schemas
│   │   └── video_schema.py            # Video request/response schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── storage_service.py         # Azure Blob Storage SAS generation
│   │   ├── queue_service.py           # Queue operations
│   │   └── video_service.py           # Video business logic
│   ├── repository/
│   │   ├── __init__.py
│   │   ├── base_repository.py         # Base CRUD operations (future)
│   │   └── video_repo.py              # Video database operations
│   ├── models/
│   │   ├── __init__.py
│   │   └── orm/                       # SQLAlchemy ORM models
│   ├── util/
│   │   ├── __init__.py
│   │   └── class_object.py            # Singleton decorator
│   ├── core/
│   │   ├── __init__.py
│   │   └── db.py                      # Database connection
│   ├── __init__.py
│   └── main.py                         # FastAPI app initialization
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

## Key Components

### 1. API Layer (`api/v1/endpoints/`)
- **Purpose:** Handle HTTP requests/responses
- **Pattern:** Clean separation of concerns
- **Example:** `video.py` - all video-related endpoints

### 2. Schema Layer (`schema/`)
- **Purpose:** Pydantic models for request/response validation
- **Pattern:** `BaseSchema` for common fields, domain-specific schemas extend it
- **Files:**
  - `base_schema.py` - Common response structures
  - `video_schema.py` - Video-specific schemas

### 3. Service Layer (`services/`)
- **Purpose:** Business logic, isolated from HTTP
- **Pattern:** Service classes with methods for domain operations
- **Example:** `VideoService.generate_upload_url()`

### 4. Repository Layer (`repository/`)
- **Purpose:** Database access patterns (CRUD)
- **Pattern:** Generic `BaseRepository` + domain-specific repositories
- **Status:** Placeholder for future DB integration

### 5. Utility Layer (`util/`)
- **Purpose:** Common utilities and decorators
- **Example:** `singleton` decorator for class instantiation

## Current Implementation

### Upload URL Generation Flow

```
Client Request (Frontend)
    ↓
POST /api/v1/videos/generate-upload-url
    ↓
video.py endpoint
    ↓
VideoService.generate_upload_url()
    ↓
storage_service.generate_upload_sas()
    ↓
Azure SDK → SAS Token + URL
    ↓
Response to client with upload_url
    ↓
Client uploads directly to Azure using BlockBlobClient
```

## Future Enhancements

1. **Dependency Injection Container**
   - Use `dependency-injector` library
   - Centralized service instantiation
   - Better testability

2. **Database Layer**
   - Implement `BaseRepository`
   - Add ORM models (Video, ProcessingJob)
   - Alembic migrations

3. **Authentication**
   - JWT bearer tokens
   - Role-based access control
   - User service

4. **API Versioning**
   - v2 endpoints alongside v1
   - Backward compatibility

5. **Error Handling**
   - Custom exceptions
   - Centralized error middleware
   - Better error messages

## Running the App

```bash
# Development
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Docker
docker-compose up backend
```

## Testing

```bash
# Unit tests
pytest app/services/ -v

# Integration tests
pytest tests/integration/ -v

# Coverage
pytest --cov=app --cov-report=html
```
