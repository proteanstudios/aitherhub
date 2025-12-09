from openai import AsyncOpenAI

client = AsyncOpenAI()

async def analyze_frame(image_path: str) -> dict:
    response = await client.responses.create(
        model="gpt-4.1-mini",
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Detect objects in this frame"},
                {"type": "input_image", "image_url": image_path},
            ],
        }],
    )
    return response.output_parsed
