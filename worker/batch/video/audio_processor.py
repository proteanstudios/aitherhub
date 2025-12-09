from batch.db_client import AsyncSessionLocal
from batch.models import SpeechSegment


async def save_speech_segments(job_id: str, segment: dict):
    async with AsyncSessionLocal() as session:
        session.add(SpeechSegment(
            job_id=job_id,
            start=segment["start"],
            end=segment["end"],
            text=segment["text"],
        ))
        await session.commit()
