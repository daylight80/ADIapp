from datetime import datetime, timedelta, timezone

import pytest

import weather_briefing as w

T0 = datetime(2026, 10, 22, 14, 0, tzinfo=timezone.utc)


def hour(offset=0, **kw):
    """A Google forecast hour starting `offset` hours after T0."""
    s = T0 + timedelta(hours=offset)
    h = {
        "interval": {"startTime": s.isoformat().replace("+00:00", "Z"), "endTime": (s + timedelta(hours=1)).isoformat().replace("+00:00", "Z")},
        "temperature": {"degrees": kw.get("temp", 12.0), "unit": "CELSIUS"},
        "precipitation": {"probability": {"percent": kw.get("p", 0)}, "qpf": {"quantity": kw.get("mm", 0), "unit": "MILLIMETERS"}},
        "wind": {"speed": {"value": 10, "unit": "KILOMETERS_PER_HOUR"}, "gust": {"value": kw.get("gust_kmh", 19), "unit": "KILOMETERS_PER_HOUR"}},
        "visibility": {"distance": kw.get("vis", 16), "unit": "KILOMETERS"},
        "thunderstormProbability": kw.get("thunder", 0),
        "weatherCondition": {"type": kw.get("cond", "CLEAR")},
    }
    return h


def rows(*hs):
    return w.parse_forecast_hours({"forecastHours": list(hs)})


def kinds(row):
    return w.flags_for_hour(row)


def test_finds_the_outward_code_in_an_address_or_on_its_own():
    assert w.outcode_from("12 High Street, Mitcham CR4 3AB") == "CR4"
    assert w.outcode_from("sw19 8aa") == "SW19"
    assert w.outcode_from("EC1A 1BB") == "EC1A"
    assert w.outcode_from("CR4") == "CR4"
    assert w.outcode_from("no postcode here") is None
    assert w.outcode_from(None) is None
    assert w.valid_outcode(" cr4 ") == "CR4"
    assert w.valid_outcode("CR4 3AB") is None and w.valid_outcode("; drop table") is None


def test_a_clear_mild_hour_has_no_flags():
    assert kinds(rows(hour())[0]) == []


def test_rain_needs_a_real_chance_and_some_amount_or_a_rain_condition():
    assert kinds(rows(hour(p=80, mm=0.6))[0]) == ["rain"]
    assert kinds(rows(hour(p=80, mm=0.0))[0]) == []          # likely but nothing measurable
    assert kinds(rows(hour(p=10, mm=0.0, cond="LIGHT_RAIN"))[0]) == ["rain"]
    assert kinds(rows(hour(p=90, mm=4.0))[0]) == ["heavy_rain"]
    assert kinds(rows(hour(cond="HEAVY_RAIN", mm=0))[0]) == ["heavy_rain"]


def test_cold_and_wet_means_ice_and_freezing_always_does():
    assert "ice" in kinds(rows(hour(temp=1.0, p=50))[0])
    assert "ice" in kinds(rows(hour(temp=-1.0))[0])
    assert "ice" not in kinds(rows(hour(temp=1.0, p=0))[0])      # cold but dry
    assert "ice" not in kinds(rows(hour(temp=5.0, p=90, mm=1.0))[0])


def test_strong_wind_fog_snow_and_thunder_are_flagged():
    assert "wind" in kinds(rows(hour(gust_kmh=60))[0])           # about 37 mph
    assert "wind" not in kinds(rows(hour(gust_kmh=40))[0])       # about 25 mph
    assert "fog" in kinds(rows(hour(vis=0.4))[0])
    assert "snow" in kinds(rows(hour(cond="LIGHT_SNOW"))[0])
    assert "thunder" in kinds(rows(hour(thunder=60))[0])


def test_wind_in_miles_per_hour_is_not_converted_twice():
    body = {"forecastHours": [hour()]}
    body["forecastHours"][0]["wind"] = {"gust": {"value": 40, "unit": "MILES_PER_HOUR"}}
    assert "wind" in kinds(w.parse_forecast_hours(body)[0])


def test_a_lesson_gets_every_flag_from_the_hours_it_overlaps_worst_first():
    hs = rows(hour(0), hour(1, p=80, mm=0.8), hour(2, gust_kmh=70), hour(3, thunder=90))
    r = w.flags_for_window(hs, T0 + timedelta(hours=1), T0 + timedelta(hours=3))
    assert [f["kind"] for f in r["flags"]] == ["wind", "rain"]   # the thunder hour is after the lesson
    assert r["covered"] is True
    assert r["summary"] == "12°C"


def test_a_lesson_outside_the_forecast_says_so_rather_than_all_clear():
    hs = rows(hour(0))
    r = w.flags_for_window(hs, T0 + timedelta(hours=10), T0 + timedelta(hours=11))
    assert r == {"flags": [], "summary": None, "covered": False}


def test_temperature_range_summary():
    hs = rows(hour(0, temp=8.4), hour(1, temp=11.6))
    r = w.flags_for_window(hs, T0, T0 + timedelta(hours=2))
    assert r["summary"] == "8 to 12°C"


def test_unreadable_forecast_rows_are_dropped():
    assert w.parse_forecast_hours({"forecastHours": [{"nothing": 1}, "x", {"interval": {"startTime": "bad", "endTime": "bad"}}]}) == []
    assert w.parse_forecast_hours(None) == [] and w.parse_forecast_hours({}) == []


def test_requested_windows_are_checked():
    now = T0
    ok = w.check_windows([{"id": "a", "start": (T0 + timedelta(hours=1)).isoformat(), "end": (T0 + timedelta(hours=3)).isoformat()}], now)
    assert ok[0]["id"] == "a" and ok[0]["end"] > ok[0]["start"]
    bad = [
        [],
        "x",
        [{"start": "nope", "end": "nope"}],
        [{"start": T0.isoformat(), "end": T0.isoformat()}],
        [{"start": T0.isoformat(), "end": (T0 + timedelta(hours=9)).isoformat()}],
        [{"start": (T0 + timedelta(days=10)).isoformat(), "end": (T0 + timedelta(days=10, hours=1)).isoformat()}],
        [{"start": T0.isoformat(), "end": (T0 + timedelta(hours=1)).isoformat()}] * (w.MAX_WINDOWS + 1),
    ]
    for b in bad:
        with pytest.raises(ValueError):
            w.check_windows(b, now)
