from openai import AsyncOpenAI

client = AsyncOpenAI()

async def speech_to_text(audio_path: str) -> list[dict]:
    with open(audio_path, "rb") as f:
        transcript = await client.audio.transcriptions.create(
            model="gpt-4o-transcribe",
            file=f
        )

    return transcript.segments
