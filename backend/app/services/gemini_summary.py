"""AI field-health summary (Google Gemini via the Python backend).

The API key never leaves the server. If no key is configured, or the upstream
call fails, FIELDZY returns a deterministic local summary that is clearly
labelled ``local_rules`` — it never presents local text as an AI response.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from ..config import GEMINI_API_KEY, GEMINI_MODEL

SYSTEM_INSTRUCTION = (
    "You are FIELDZY's agricultural field-health summariser. You write for a working farmer. "
    "Use plain, calm language in three short paragraphs (no headings, no bullet lists, under 170 words). "
    "Only describe what the provided records actually support. Never state or imply that a crop disease, "
    "pest or intrusion is confirmed when its evidence status is unverified, needs_review, inconclusive or "
    "conflicting — instead say what is suspected and what is still missing. Mention evidence debt when it "
    "is non-zero and recommend the single most useful next field action. Do not invent numbers, weather "
    "readings, sensor data, treatments or product dosages. Do not give chemical application instructions; "
    "recommend local extension advice instead."
)


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _local_summary(fields: list[dict[str, Any]], observations: list[dict[str, Any]], debt: dict[str, Any] | None = None) -> dict[str, Any]:
    from ..evidence_engine import UNRESOLVED_STATUSES

    total_fields = len(fields)
    unresolved = [o for o in observations if o.get("status") in UNRESOLVED_STATUSES]
    verified = [o for o in observations if o.get("status") == "verified"]
    attention = [f for f in fields if f.get("status") == "attention"]
    open_gaps = sum(1 for o in observations for g in (o.get("evidenceGaps") or []) if not g.get("resolved"))

    if not fields:
        summary = (
            "No fields are registered yet. Add a field to begin collecting observations, and FIELDZY "
            "will build the health summary from your own records."
        )
        return {"summary": summary, "highlights": []}

    first = (
        f"{total_fields} field{'s' if total_fields != 1 else ''} are registered with FIELDZY, and "
        f"{len(verified)} observation{'s' if len(verified) != 1 else ''} currently carry a recorded review. "
        f"{len(attention)} field{'s' if len(attention) != 1 else ''} need attention today."
    )

    if unresolved:
        sample = ", ".join(o["title"].split(" — ")[0][:60] for o in unresolved[:3])
        second = (
            f"{len(unresolved)} report{'s are' if len(unresolved) != 1 else ' is'} still open, with "
            f"{open_gaps} outstanding evidence gap{'s' if open_gaps != 1 else ''}. These include {sample}. "
            "Treat them as things to check rather than confirmed problems — closing the evidence gaps will "
            "make the picture much clearer."
        )
    else:
        second = (
            "Every open observation has its supporting evidence filed. No unresolved evidence remains on "
            "the registered fields."
        )

    if open_gaps:
        third = (
            f"The most useful next step is to close the {open_gaps} outstanding evidence gap"
            f"{'s' if open_gaps != 1 else ''}: a short field walk with the phone camera and a moisture "
            "reading will settle most of them. Weather context comes from Open-Meteo and is not a field "
            "measurement."
        )
    else:
        third = (
            "Keep scouting the fields on your normal round and log what you see; a regular record is what "
            "makes later warnings trustworthy."
        )

    return {
        "summary": f"{first}\n\n{second}\n\n{third}",
        "highlights": [
            f"{total_fields} fields registered",
            f"{len(unresolved)} reports awaiting evidence or review",
            f"{open_gaps} evidence gaps open",
        ],
    }


def _prompt(fields: list[dict[str, Any]], observations: list[dict[str, Any]]) -> str:
    lines = ["REGISTERED FIELDS:"]
    for f in fields:
        lines.append(
            f"- {f.get('name')} ({f.get('id')}), crop {f.get('crop')}, {f.get('areaHa')} ha, "
            f"status {f.get('status')}, soil thresholds low {f.get('soilThresholdLow')}% / "
            f"critical {f.get('soilThresholdCritical')}%"
        )
    lines.append("\nOBSERVATIONS (most recent first):")
    for o in observations[:24]:
        gaps = sum(1 for g in (o.get("evidenceGaps") or []) if not g.get("resolved"))
        lines.append(
            f"- [{o.get('status')}] {o.get('title')} | field {o.get('fieldName')} | feature "
            f"{o.get('feature')} | confidence {o.get('confidence')} | open evidence gaps {gaps} | "
            f"next action: {o.get('nextAction')} | demo record: {bool(o.get('isDemo'))}"
        )
    lines.append(
        "\nWrite the summary. If a report is not verified, describe it as awaiting evidence. "
        "Do not use markdown formatting."
    )
    return "\n".join(lines)


def generate_summary(fields: list[dict[str, Any]], observations: list[dict[str, Any]], debt: dict[str, Any] | None = None) -> dict[str, Any]:
    local = _local_summary(fields, observations, debt)
    base = {
        "generatedAt": _now(),
        "model": GEMINI_MODEL,
        "provider": "Google Gemini",
        "keyConfigured": bool(GEMINI_API_KEY),
    }

    if not GEMINI_API_KEY:
        return {
            **base,
            "available": False,
            "source": "local_rules",
            "status": "unconfigured",
            "summary": local["summary"],
            "highlights": local["highlights"],
            "notice": (
                "Gemini is not configured on this deployment (GEMINI_API_KEY is unset), so FIELDZY produced "
                "a deterministic local summary from your records. Add the key to backend/.env to enable AI "
                "summaries."
            ),
        }

    try:
        from google import genai  # type: ignore

        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=_prompt(fields, observations),
            config={"system_instruction": SYSTEM_INSTRUCTION, "temperature": 0.4},
        )
        text = (getattr(response, "text", None) or "").strip()
        if not text:
            raise RuntimeError("Gemini returned an empty response")
        return {
            **base,
            "available": True,
            "source": "gemini",
            "status": "ok",
            "summary": text,
            "highlights": local["highlights"],
            "notice": f"Generated by Google {GEMINI_MODEL} from your FIELDZY records.",
        }
    except Exception as exc:
        return {
            **base,
            "available": False,
            "source": "local_rules",
            "status": "upstream_error",
            "summary": local["summary"],
            "highlights": local["highlights"],
            "error": f"{exc.__class__.__name__}: {exc}",
            "notice": (
                f"The Gemini request did not succeed ({exc.__class__.__name__}). FIELDZY fell back to a local "
                "summary so the dashboard still has an accurate, plainly-labelled report."
            ),
        }
