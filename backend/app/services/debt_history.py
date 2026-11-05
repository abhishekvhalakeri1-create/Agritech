"""Evidence Debt history and ledger helpers.

Two complementary sources of truth:

* **Recorded snapshots** — written whenever an observation, gap or review
  changes. These are exact, timestamped observation points.
* **Reconstructed replay** — the seeded records predate snapshotting, so the
  past is replayed from the timestamps that *are* on record (observation
  creation times, review history entries, gap resolution times). The replay uses
  the same ``score_from_counts`` function as the live meter, so it can never
  drift from the real formula. Points are labelled ``reconstructed`` in the API.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from .. import db
from ..evidence_engine import (
    UNRESOLVED_STATUSES,
    collect_gaps,
    evidence_debt,
    parse_timestamp,
    score_from_counts,
)

MIN_SNAPSHOT_GAP_SECONDS = 90


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def record_snapshot(trigger: str, observation_id: str | None = None, *, force: bool = False) -> dict[str, Any] | None:
    """Write a debt snapshot after a meaningful change.

    Snapshots are de-duplicated: nothing is written when the score and its terms
    are unchanged within the last 90 seconds, so reading the dashboard does not
    manufacture activity.
    """
    debt = evidence_debt(db.fetch_all("observations"))
    components = debt["components"]
    previous = db.fetch_all("debtSnapshots", order="createdAt DESC")
    if previous and not force:
        last = previous[0]
        same = (
            last["score"] == debt["score"]
            and last["gapTerm"] == components["gapTerm"]
            and last["observationTerm"] == components["observationTerm"]
        )
        last_at = parse_timestamp(last.get("createdAt"))
        recent = last_at is not None and (datetime.now(timezone.utc) - last_at).total_seconds() < MIN_SNAPSHOT_GAP_SECONDS
        if same and recent:
            return None

    snapshot = {
        "id": f"DBT-{uuid.uuid4().hex[:8]}",
        "score": debt["score"],
        "gapTerm": components["gapTerm"],
        "observationTerm": components["observationTerm"],
        "unresolvedGaps": components["unresolvedGaps"],
        "unresolvedObservations": components["unresolvedObservations"],
        "trigger": trigger,
        "observationId": observation_id,
        "createdAt": _now(),
    }
    db.insert("debtSnapshots", snapshot)
    return snapshot


def _baseline_status(obs: dict[str, Any]) -> str:
    """Status the observation had when it was created."""
    for entry in reversed(obs.get("reviewHistory") or []):
        if entry.get("decision") == "created" and entry.get("status"):
            return entry["status"]
    return (obs.get("validation") or {}).get("status") or obs.get("status") or "unverified"


def _state_at(when: datetime, observations: list[dict[str, Any]], gaps_all: list[dict[str, Any]]) -> tuple[int, int]:
    """Debt inputs at one moment: (open gaps, unresolved observations)."""
    open_gaps = 0
    for gap in gaps_all:
        created = parse_timestamp(gap.get("createdAt"))
        resolved = parse_timestamp(gap.get("resolvedAt"))
        if created is None or created > when:
            continue
        if resolved is not None and resolved <= when:
            continue
        open_gaps += 1

    unresolved_observations = 0
    review_decisions = {"verify", "resolve", "reject", "flag_conflict", "request_evidence"}
    for obs in observations:
        created = parse_timestamp(obs.get("createdAt"))
        if created is None or created > when:
            continue
        status = _baseline_status(obs)
        # Oldest → newest, so the most recent decision at or before `when` wins.
        # Gap-resolution entries are ignored: they never gate the review state.
        entries = [
            entry
            for entry in (obs.get("reviewHistory") or [])
            if entry.get("decision") in review_decisions and entry.get("status")
        ]
        for entry in reversed(entries):
            entry_at = parse_timestamp(entry.get("at"))
            if entry_at and entry_at <= when:
                status = entry["status"]
        if status in UNRESOLVED_STATUSES:
            unresolved_observations += 1
    return open_gaps, unresolved_observations


def _point(when: datetime, observations, gaps_all, source: str) -> dict[str, Any]:
    open_gaps, open_observations = _state_at(when, observations, gaps_all)
    counts = score_from_counts(open_gaps, open_observations)
    return {
        "at": when.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "score": counts["score"],
        "unresolvedGaps": open_gaps,
        "unresolvedObservations": open_observations,
        "source": source,
    }


def _replay(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rebuild the debt series from the timestamps on record.

    Change points come from real events (creation, review, gap resolution); the
    rest of the curve is sampled every 12 hours through the same state function,
    so no interpolation or guesswork is involved.
    """
    gaps_all = collect_gaps(observations, include_resolved=True)
    times: set[datetime] = set()
    for obs in observations:
        created = parse_timestamp(obs.get("createdAt"))
        if created:
            times.add(created.replace(microsecond=0))
        for entry in obs.get("reviewHistory") or []:
            entry_at = parse_timestamp(entry.get("at"))
            if entry_at:
                times.add(entry_at.replace(microsecond=0))
    for gap in gaps_all:
        for key in ("createdAt", "resolvedAt"):
            stamp = parse_timestamp(gap.get(key))
            if stamp:
                times.add(stamp.replace(microsecond=0))

    now = datetime.now(timezone.utc)
    earliest = min(times) if times else now
    for step in range(14, -1, -1):
        when = (now - timedelta(hours=12 * step)).replace(minute=0, second=0, microsecond=0)
        if when >= earliest - timedelta(hours=1):
            times.add(when)

    # De-duplicate on the ISO string and keep the last week at most.
    window_start = now - timedelta(days=8)
    points: dict[str, dict[str, Any]] = {}
    for when in sorted(times):
        if when < window_start:
            continue
        point = _point(when, observations, gaps_all, "reconstructed")
        points[point["at"]] = point
    return list(points.values())[-60:]


def history(limit: int = 80) -> dict[str, Any]:
    observations = db.fetch_all("observations")
    debt = evidence_debt(observations)
    recorded = [
        {
            "at": row["createdAt"],
            "score": row["score"],
            "unresolvedGaps": row["unresolvedGaps"],
            "unresolvedObservations": row["unresolvedObservations"],
            "source": "recorded",
            "trigger": row.get("trigger"),
            "observationId": row.get("observationId"),
        }
        for row in db.fetch_all("debtSnapshots", order="createdAt ASC")
    ][-limit:]
    reconstructed = _replay(observations)

    # Recorded snapshots are authoritative from the moment they start; drop any
    # replayed points that fall inside the recorded window so the two never
    # contradict each other.
    if recorded:
        first_recorded = parse_timestamp(recorded[0]["at"])
        if first_recorded is not None:
            reconstructed = [
                point
                for point in reconstructed
                if (parse_timestamp(point["at"]) or first_recorded) < first_recorded
            ]

    series = sorted(reconstructed + recorded, key=lambda point: point["at"])
    if not series or series[-1]["at"] < debt["computedAt"]:
        series.append(
            {
                "at": debt["computedAt"],
                "score": debt["score"],
                "unresolvedGaps": debt["components"]["unresolvedGaps"],
                "unresolvedObservations": debt["components"]["unresolvedObservations"],
                "source": "live",
            }
        )

    day_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    past = [point for point in series if (parse_timestamp(point["at"]) or day_ago) <= day_ago]
    delta_24h = (debt["score"] - past[-1]["score"]) if past else 0
    scores = [point["score"] for point in series]

    return {
        "current": debt["score"],
        "series": series,
        "recorded": recorded,
        "reconstructed": reconstructed,
        "delta24h": delta_24h,
        "min": min(scores) if scores else debt["score"],
        "max": max(scores) if scores else debt["score"],
        "points": len(series),
        "explanation": (
            "Recorded snapshots are written when an observation, gap or review changes. Earlier points are "
            "reconstructed from the timestamps already on record (creation, review and gap-resolution times) "
            "using the same formula as the live meter."
        ),
        "computedAt": debt["computedAt"],
    }


def ledger(*, status: str = "open", severity: str | None = None, field_id: str | None = None,
           feature: str | None = None, limit: int = 200) -> dict[str, Any]:
    observations = db.fetch_all("observations")
    include_resolved = status in {"all", "resolved"}
    gaps = collect_gaps(observations, include_resolved=include_resolved)
    if status == "open":
        gaps = [gap for gap in gaps if not gap["resolved"]]
    elif status == "resolved":
        gaps = [gap for gap in gaps if gap["resolved"]]

    if severity:
        gaps = [gap for gap in gaps if gap["severity"] == severity]
    if field_id:
        gaps = [gap for gap in gaps if gap.get("fieldId") == field_id]
    if feature:
        gaps = [gap for gap in gaps if gap["feature"] == feature]

    severity_rank = {"high": 0, "medium": 1, "low": 2}
    gaps.sort(
        key=lambda gap: (
            gap["resolved"],
            severity_rank.get(gap["severity"], 1),
            -(gap.get("ageHours") or 0),
        )
    )
    return {
        "gaps": gaps[:limit],
        "count": len(gaps),
        "filters": {"status": status, "severity": severity, "fieldId": field_id, "feature": feature},
        "debt": evidence_debt(observations)["score"],
        "staleCount": sum(1 for gap in gaps if gap["stale"]),
    }


CSV_COLUMNS = [
    ("gapId", "Gap ID"),
    ("code", "Code"),
    ("description", "Evidence gap"),
    ("detail", "Detail"),
    ("severity", "Severity"),
    ("resolved", "Resolved"),
    ("ageHours", "Age (hours)"),
    ("stale", "Stale over 48h"),
    ("observationId", "Observation ID"),
    ("observationTitle", "Observation"),
    ("observationStatus", "Observation status"),
    ("fieldId", "Field ID"),
    ("fieldName", "Field"),
    ("feature", "Feature"),
    ("createdAt", "Opened at"),
    ("resolvedAt", "Resolved at"),
    ("resolvedBy", "Resolved by"),
    ("resolutionNote", "Resolution note"),
]


def ledger_csv(gaps: Iterable[dict[str, Any]]) -> str:
    import csv
    import io

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([label for _, label in CSV_COLUMNS])
    for gap in gaps:
        writer.writerow(
            [
                "" if gap.get(key) is None else ("yes" if gap[key] is True else "no" if gap[key] is False else gap[key])
                for key, _ in CSV_COLUMNS
            ]
        )
    return buffer.getvalue()
