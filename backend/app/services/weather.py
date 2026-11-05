"""Open-Meteo integration.

FIELDZY never invents a weather reading. If the upstream call fails, the API
returns ``available: false`` with the reason and the UI shows an error state.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import DEFAULT_LAT, DEFAULT_LON, WEATHER_TIMEOUT_SECONDS

CACHE_TTL_SECONDS = 600
_cache: dict[str, Any] = {"key": None, "at": 0.0, "payload": None}

WEATHER_CODES = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    80: "Rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail",
}


async def fetch_weather(latitude: float | None, longitude: float | None, *, force: bool = False) -> dict[str, Any]:
    lat = float(latitude if latitude is not None else DEFAULT_LAT)
    lon = float(longitude if longitude is not None else DEFAULT_LON)
    key = f"{lat:.3f},{lon:.3f}"

    now = time.time()
    if not force and _cache["key"] == key and (now - _cache["at"]) < CACHE_TTL_SECONDS and _cache["payload"]:
        payload = dict(_cache["payload"])
        payload["cached"] = True
        payload["cacheAgeSeconds"] = int(now - _cache["at"])
        return payload

    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
        "hourly": "precipitation_probability",
        "forecast_days": 1,
        "timezone": "auto",
    }

    try:
        async with httpx.AsyncClient(timeout=WEATHER_TIMEOUT_SECONDS) as client:
            response = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
        response.raise_for_status()
        data = response.json()
    except Exception as exc:
        payload = {
            "available": False,
            "source": "Open-Meteo",
            "error": f"Weather source unreachable: {exc.__class__.__name__}",
            "detail": "FIELDZY does not display estimated or remembered values as live weather.",
            "latitude": lat,
            "longitude": lon,
            "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        return payload

    current = data.get("current") or {}
    hourly = data.get("hourly") or {}
    probabilities = hourly.get("precipitation_probability") or []
    times = hourly.get("time") or []
    next_six = [p for p in probabilities[:6] if p is not None]
    code = current.get("weather_code")

    payload = {
        "available": True,
        "source": "Open-Meteo",
        "attribution": "Weather data by Open-Meteo (open-meteo.com), CC BY 4.0",
        "cached": False,
        "latitude": data.get("latitude", lat),
        "longitude": data.get("longitude", lon),
        "timezone": data.get("timezone", "UTC"),
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "current": {
            "temperature": current.get("temperature_2m"),
            "apparentTemperature": current.get("apparent_temperature"),
            "humidity": current.get("relative_humidity_2m"),
            "windSpeed": current.get("wind_speed_10m"),
            "windDirection": current.get("wind_direction_10m"),
            "precipitation": current.get("precipitation"),
            "weatherCode": code,
            "condition": WEATHER_CODES.get(code, "Unknown conditions"),
            "observedAt": current.get("time"),
        },
        "rainProbabilityNext6h": max(next_six) if next_six else None,
        "rainProbabilitySeries": probabilities[:12],
        "hourlyTimes": times[:12],
    }
    _cache.update({"key": key, "at": now, "payload": payload})
    return payload
