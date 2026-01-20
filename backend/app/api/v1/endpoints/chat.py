import os
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel

from app.core.dependencies import get_current_user, get_db
from app.models.orm.chat import Chat as ChatModel
from sqlalchemy import insert
from starlette.background import BackgroundTask
import psycopg2


class ChatRequest(BaseModel):
    messages: List[Dict[str, Any]]
    max_tokens: Optional[int] = 2048
    model: Optional[str] = None


router = APIRouter(
    prefix="/chat",
    tags=["chat"],
)


@router.post("/stream")
async def stream_chat(
    payload: ChatRequest,
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Proxy Azure OpenAI streaming responses and return SSE to client.

    Requires authenticated user (via `get_current_user`). Client should open
    an EventSource to receive `data: ...` events containing token deltas.
    """
    try:
        # Read config from environment
        from openai import AzureOpenAI

        api_key = os.getenv("AZURE_OPENAI_KEY")
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        api_version = os.getenv("GPT5_API_VERSION") or "2024-12-01-preview"
        model = payload.model or os.getenv("GPT5_MODEL") or os.getenv("GPT5_DEPLOYMENT")

        if not api_key or not endpoint:
            raise HTTPException(status_code=500, detail="OpenAI configuration missing on server")

        # fetch latest report for the video (if any) and inject as system message
        # ensure video has finished processing (status == 'DONE') before answering
        try:
            sql_status = text("SELECT status FROM videos WHERE id = :video_id")
            sres = await db.execute(sql_status, {"video_id": video_id})
            vstatus = sres.scalar_one_or_none()
            if vstatus is None or str(vstatus).upper() != "DONE":
                raise HTTPException(status_code=400, detail="Chat unavailable: video report not ready")
        except HTTPException:
            raise
        except Exception:
            # if DB check fails for unexpected reasons, stop with server error
            raise HTTPException(status_code=500, detail="Failed to verify video status")

        report_text = ""
        try:
            sql_join = text(
                "SELECT pi.phase_index, pi.insight, vp.phase_description, vp.time_start, vp.time_end, "
                "vp.view_start, vp.view_end, vp.like_start, vp.like_end, vp.delta_view, vp.delta_like "
                "FROM phase_insights pi "
                "LEFT JOIN video_phases vp ON pi.video_id = vp.video_id AND pi.phase_index = vp.phase_index "
                "WHERE pi.video_id = :video_id "
                "ORDER BY pi.phase_index ASC"
            )
            res = await db.execute(sql_join, {"video_id": video_id})
            rows = res.fetchall()

            parts: List[str] = []
            if rows:
                for r in rows:
                    try:
                        idx = getattr(r, "phase_index", None) or r[0]
                    except Exception:
                        idx = r[0] if len(r) > 0 else "?"
                    try:
                        insight = getattr(r, "insight", None) or r[1]
                    except Exception:
                        insight = r[1] if len(r) > 1 else ""

                    try:
                        p_desc = getattr(r, "phase_description", None) or r[2]
                    except Exception:
                        p_desc = r[2] if len(r) > 2 else None
                    try:
                        p_time_start = getattr(r, "time_start", None) or r[3]
                    except Exception:
                        p_time_start = r[3] if len(r) > 3 else None
                    try:
                        p_time_end = getattr(r, "time_end", None) or r[4]
                    except Exception:
                        p_time_end = r[4] if len(r) > 4 else None
                    try:
                        p_view_start = getattr(r, "view_start", None) if hasattr(r, "view_start") else (r[5] if len(r) > 5 else None)
                    except Exception:
                        p_view_start = r[5] if len(r) > 5 else None
                    try:
                        p_view_end = getattr(r, "view_end", None) if hasattr(r, "view_end") else (r[6] if len(r) > 6 else None)
                    except Exception:
                        p_view_end = r[6] if len(r) > 6 else None
                    try:
                        p_like_start = getattr(r, "like_start", None) if hasattr(r, "like_start") else (r[7] if len(r) > 7 else None)
                    except Exception:
                        p_like_start = r[7] if len(r) > 7 else None
                    try:
                        p_like_end = getattr(r, "like_end", None) if hasattr(r, "like_end") else (r[8] if len(r) > 8 else None)
                    except Exception:
                        p_like_end = r[8] if len(r) > 8 else None
                    try:
                        p_delta_view = getattr(r, "delta_view", None) if hasattr(r, "delta_view") else (r[9] if len(r) > 9 else None)
                    except Exception:
                        p_delta_view = r[9] if len(r) > 9 else None
                    try:
                        p_delta_like = getattr(r, "delta_like", None) if hasattr(r, "delta_like") else (r[10] if len(r) > 10 else None)
                    except Exception:
                        p_delta_like = r[10] if len(r) > 10 else None

                    header = f"Phase {idx}"
                    if p_desc:
                        header += f": {p_desc}"
                    if p_time_start is not None or p_time_end is not None:
                        ts = f"{p_time_start if p_time_start is not None else ''}" \
                            f"-{p_time_end if p_time_end is not None else ''}"
                        header += f" ({ts}s)"

                    combined = header
                    if insight:
                        combined += f"\nInsight: {insight}"

                    metrics_lines = []
                    if p_view_start is not None or p_view_end is not None or p_delta_view is not None:
                        vs = f"start={p_view_start}" if p_view_start is not None else ""
                        ve = f"end={p_view_end}" if p_view_end is not None else ""
                        dv = f"delta={p_delta_view}" if p_delta_view is not None else ""
                        metrics = ", ".join([m for m in [vs, ve, dv] if m])
                        metrics_lines.append(f"Views: {metrics}")
                    if p_like_start is not None or p_like_end is not None or p_delta_like is not None:
                        ls = f"start={p_like_start}" if p_like_start is not None else ""
                        le = f"end={p_like_end}" if p_like_end is not None else ""
                        dl = f"delta={p_delta_like}" if p_delta_like is not None else ""
                        metrics = ", ".join([m for m in [ls, le, dl] if m])
                        metrics_lines.append(f"Likes: {metrics}")

                    if metrics_lines:
                        combined += "\n" + "\n".join(metrics_lines)

                    parts.append(combined)

            report_text = "\n\n".join(parts) if parts else ""
        except Exception:
            try:
                sql_insights = text(
                    "SELECT phase_index, insight FROM phase_insights WHERE video_id = :video_id ORDER BY phase_index ASC"
                )
                res_ins = await db.execute(sql_insights, {"video_id": video_id})
                rows_ins = res_ins.fetchall()

                phases_map: Dict[Any, Dict[str, Any]] = {}
                try:
                    sql_phases = text(
                        "SELECT phase_index, title, description, view_count, like_count FROM video_phases WHERE video_id = :video_id ORDER BY phase_index ASC"
                    )
                    res_ph = await db.execute(sql_phases, {"video_id": video_id})
                    rows_ph = res_ph.fetchall()
                    if rows_ph:
                        for r in rows_ph:
                            try:
                                p_idx = getattr(r, "phase_index", None) or r[0]
                            except Exception:
                                p_idx = r[0] if len(r) > 0 else None
                            try:
                                p_title = getattr(r, "title", None) or r[1]
                            except Exception:
                                p_title = r[1] if len(r) > 1 else None
                            try:
                                p_desc = getattr(r, "description", None) or r[2]
                            except Exception:
                                p_desc = r[2] if len(r) > 2 else None
                            try:
                                p_views = getattr(r, "view_count", None) if hasattr(r, "view_count") else (r[3] if len(r) > 3 else None)
                            except Exception:
                                p_views = r[3] if len(r) > 3 else None
                            try:
                                p_likes = getattr(r, "like_count", None) if hasattr(r, "like_count") else (r[4] if len(r) > 4 else None)
                            except Exception:
                                p_likes = r[4] if len(r) > 4 else None
                            if p_idx is not None:
                                phases_map[p_idx] = {
                                    "title": p_title or "",
                                    "description": p_desc or "",
                                    "views": p_views,
                                    "likes": p_likes,
                                }
                except Exception:
                    phases_map = {}

                parts: List[str] = []
                if rows_ins:
                    for r in rows_ins:
                        try:
                            idx = getattr(r, "phase_index", None) or r[0]
                        except Exception:
                            idx = r[0] if len(r) > 0 else "?"
                        try:
                            insight = getattr(r, "insight", None) or r[1]
                        except Exception:
                            insight = r[1] if len(r) > 1 else ""

                        phase_info = phases_map.get(idx)
                        if phase_info:
                            title = phase_info.get("title") or ""
                            desc = phase_info.get("description") or ""
                            header = f"Phase {idx}: {title}" if title else f"Phase {idx}"
                            combined = header
                            if desc:
                                combined += f" - {desc}"
                            if insight:
                                combined += f"\nInsight: {insight}"
                            views = phase_info.get("views")
                            likes = phase_info.get("likes")
                            metrics = []
                            if views is not None:
                                metrics.append(f"views={views}")
                            if likes is not None:
                                metrics.append(f"likes={likes}")
                            if metrics:
                                combined += f"\nMetrics: {', '.join(metrics)}"
                            parts.append(combined)
                        else:
                            parts.append(f"Phase {idx}: {insight}")
                report_text = "\n\n".join(parts) if parts else ""
            except Exception:
                report_text = ""

        system_msg = {
            "role": "system",
            "content": (
                "Hãy trả lời theo ngôn ngữ của người hỏi, xoay quanh báo cáo sau:\n\n"
                + (report_text or "(no report available)")
            ),
        }

        # load recent chat history for this video (quick-history: last N QA pairs)
        history_msgs: List[Dict[str, Any]] = []
        try:
            history_limit = int(os.getenv("CHAT_HISTORY_LIMIT", "10"))
            sql_hist = text(
                "SELECT question, answer FROM chats WHERE video_id = :video_id ORDER BY created_at DESC LIMIT :limit"
            )
            hres = await db.execute(sql_hist, {"video_id": video_id, "limit": history_limit})
            hrows = hres.fetchall()
            if hrows:
                for r in list(reversed(hrows)):
                    try:
                        q_text = getattr(r, "question", None) or r[0]
                    except Exception:
                        q_text = r[0] if len(r) > 0 else ""
                    try:
                        a_text = getattr(r, "answer", None) or r[1]
                    except Exception:
                        a_text = r[1] if len(r) > 1 else ""
                    history_msgs.append({"role": "user", "content": q_text})
                    history_msgs.append({"role": "assistant", "content": a_text})
        except Exception:
            # non-fatal: if history load fails, continue without it
            history_msgs = []

        client = AzureOpenAI(api_key=api_key, azure_endpoint=endpoint, api_version=api_version)

        # accumulate parts in outer scope so background task can read them
        full_answer_parts: List[str] = []

        def event_generator():
            try:
                call_messages = [system_msg] + history_msgs + payload.messages

                # Responses API (new): messages -> input. Build input payload.
                input_payload = []
                for m in call_messages:
                    # keep structure role/content
                    try:
                        input_payload.append({"role": m.get("role"), "content": m.get("content")})
                    except Exception:
                        # skip malformed
                        continue

                resp = client.responses.create(
                    stream=True,
                    model=model,
                    input=input_payload,
                    max_output_tokens=payload.max_tokens,
                )

                # accumulate full answer to persist after stream
                for update in resp:
                    try:
                        # Try common fields for streamed chunks across SDKs
                        text_chunk = None
                        # delta events on the update object
                        if getattr(update, "delta", None):
                            text_chunk = getattr(update, "delta")
                        # direct text field
                        if not text_chunk:
                            text_chunk = getattr(update, "text", None)
                        # older field used by some events
                        if not text_chunk:
                            text_chunk = getattr(update, "output_text", None)

                        # dict-like fallback
                        if not text_chunk and isinstance(update, dict):
                            text_chunk = update.get("delta") or update.get("output_text") or update.get("text") or update.get("content")

                        # try choices/delta style fallback
                        if not text_chunk:
                            choices = getattr(update, "choices", None) or (update.get("choices") if isinstance(update, dict) else None)
                            if choices:
                                first = choices[0]
                                delta = getattr(first, "delta", None) or (first.get("delta") if isinstance(first, dict) else None)
                                if delta:
                                    text_chunk = getattr(delta, "text", None) or (delta.get("text") if isinstance(delta, dict) else None) or getattr(delta, "content", None) or (delta.get("content") if isinstance(delta, dict) else None)

                        # try output array structure
                        if not text_chunk:
                            out = getattr(update, "output", None) if not isinstance(update, dict) else update.get("output")
                            if out:
                                if isinstance(out, str):
                                    text_chunk = out
                                elif isinstance(out, list):
                                    parts = []
                                    for o in out:
                                        if isinstance(o, dict):
                                            c = o.get("content")
                                            if isinstance(c, str):
                                                parts.append(c)
                                            elif isinstance(c, list):
                                                for p in c:
                                                    if isinstance(p, dict):
                                                        parts.append(p.get("text") or p.get("content") or "")
                                    if parts:
                                        text_chunk = "".join(parts)

                        if text_chunk:
                            full_answer_parts.append(text_chunk)
                            yield f"data: {text_chunk}\n\n"
                    except Exception:
                        # ignore streaming chunk parse errors
                        continue

                # signal end
                yield "data: [DONE]\n\n"

                # after stream completes, leave persistence to background task
                pass

            except Exception as e:
                # send error as SSE and finish
                yield f"data: [ERROR] {str(e)}\n\n"
            finally:
                try:
                    client.close()
                except Exception:
                    pass

        # background task: use synchronous psycopg2 insert so commit is immediate
        def _bg_save_sync() -> None:
            try:
                full_answer = "".join(full_answer_parts)
                try:
                    if "\\n" in full_answer or "\\r\\n" in full_answer:
                        full_answer = full_answer.replace('\\r\\n', '\r\n').replace('\\n', '\n')
                except Exception:
                    pass
                question_text = None
                for m in reversed(payload.messages):
                    if m.get("role") == "user":
                        question_text = m.get("content")
                        break

                # adapt DATABASE_URL for psycopg2 if needed
                db_url = os.getenv("DATABASE_URL") or ""
                if db_url.startswith("postgresql+asyncpg://"):
                    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

                # connect and insert
                conn = psycopg2.connect(db_url)
                try:
                    cur = conn.cursor()
                    cur.execute(
                        "INSERT INTO chats (video_id, question, answer, id, created_at, updated_at) VALUES (%s, %s, %s, gen_random_uuid(), now(), now())",
                        (video_id, question_text, full_answer),
                    )
                    conn.commit()
                    cur.close()
                finally:
                    conn.close()
            except Exception:
                # non-fatal: swallow errors
                pass

        bg = BackgroundTask(_bg_save_sync)
        return StreamingResponse(event_generator(), media_type="text/event-stream", background=bg)

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Streaming failure: {exc}")


@router.get("/history")
async def get_chat_history(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Return chat history for a given video_id.

    Requires authentication. Returns JSON `{"data": [...]}` where each item
    contains `id`, `video_id`, `question`, `answer`, `created_at`, `updated_at`.
    """
    if not video_id:
        raise HTTPException(status_code=400, detail="Missing video_id")

    try:
        sql = text(
            "SELECT id, video_id, question, answer, created_at, updated_at FROM chats WHERE video_id = :video_id ORDER BY created_at ASC"
        )
        res = await db.execute(sql, {"video_id": video_id})
        rows = res.fetchall()

        out = []
        for r in rows:
            try:
                row_id = getattr(r, "id", None) or r[0]
            except Exception:
                row_id = r[0] if len(r) > 0 else None
            try:
                v_id = getattr(r, "video_id", None) or r[1]
            except Exception:
                v_id = r[1] if len(r) > 1 else None
            try:
                question = getattr(r, "question", None) or r[2]
            except Exception:
                question = r[2] if len(r) > 2 else None
            try:
                answer = getattr(r, "answer", None) or r[3]
            except Exception:
                answer = r[3] if len(r) > 3 else None
            try:
                created_at = getattr(r, "created_at", None) or r[4]
            except Exception:
                created_at = r[4] if len(r) > 4 else None
            try:
                updated_at = getattr(r, "updated_at", None) or r[5]
            except Exception:
                updated_at = r[5] if len(r) > 5 else None

            out.append(
                {
                    "id": row_id,
                    "video_id": v_id,
                    "question": question,
                    "answer": answer,
                    "created_at": created_at,
                    "updated_at": updated_at,
                }
            )

        return {"data": out}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch chat history: {exc}")
