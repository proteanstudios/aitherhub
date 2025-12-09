import asyncio
from controller.queue_reader import get_next_job
from controller.batch_submitter import submit_batch_job


async def main():
    while True:
        job = await get_next_job()
        if job:
            await submit_batch_job(job)


if __name__ == "__main__":
    asyncio.run(main())
