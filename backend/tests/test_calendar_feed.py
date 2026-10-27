from datetime import datetime, timezone

import calendar_feed as cf

NOW = datetime(2026, 10, 22, 12, 0, tzinfo=timezone.utc)


def lesson(**kw):
    base = {
        "id": "l1", "start_time": "2026-10-22T09:00:00+00:00", "end_time": "2026-10-22T10:00:00+00:00",
        "topic": "Roundabouts", "notes": "", "pickup_address": "10 Waterloo Road, SM1 4LS", "status": "Scheduled",
        "duration_hours": 1, "lesson_type": "Standard", "students": {"full_name": "Sam Smith", "address": "1 High St", "postcode": "CR4 3AB"},
    }
    base.update(kw)
    return base


def events(ics):
    """The calendar's events as {UID: {PROPERTY: value}} (unfolded)."""
    text = ics.replace("\r\n ", "")
    out, cur = {}, None
    for ln in text.split("\r\n"):
        if ln == "BEGIN:VEVENT":
            cur = {}
        elif ln == "END:VEVENT":
            out[cur["UID"]] = cur
            cur = None
        elif cur is not None and ":" in ln:
            k, v = ln.split(":", 1)
            cur[k] = v
    return out


def build(lessons=(), blocks=(), **kw):
    return cf.build_ics(list(lessons), list(blocks), "Jon Kenny", NOW, **kw)


def test_a_normal_lesson_has_the_pupil_topic_length_and_pickup():
    ev = events(build([lesson(notes="Mirrors")]))["lesson-l1@adipro.app"]
    assert ev["SUMMARY"] == "Driving lesson — Sam Smith"
    assert ev["DESCRIPTION"] == "Roundabouts · 1h · Mirrors"
    assert ev["LOCATION"] == "10 Waterloo Road\\, SM1 4LS"
    assert ev["DTSTART"] == "20261022T090000Z" and ev["DTEND"] == "20261022T100000Z"
    assert ev["TRANSP"] == "OPAQUE"


def test_without_a_pickup_it_uses_the_pupils_address():
    ev = events(build([lesson(pickup_address=None)]))["lesson-l1@adipro.app"]
    assert ev["LOCATION"] == "1 High St\\, CR4 3AB"


def test_a_practical_test_says_so_with_the_test_time_in_uk_time_and_the_centre():
    # 10:15 BST is 09:15 UTC on 22 October 2026
    ev = events(build([lesson(lesson_type="Practical Test", test_centre="Morden Test Centre", test_start="2026-10-22T09:15:00+00:00",
                              duration_hours=2.5, end_time="2026-10-22T11:30:00+00:00")]))["lesson-l1@adipro.app"]
    assert ev["SUMMARY"] == "Practical test — Sam Smith"
    assert ev["DESCRIPTION"].startswith("Practical test at 10:15\\, Morden Test Centre")
    assert "Pick-up: 10 Waterloo Road" in ev["DESCRIPTION"]
    assert "2.5h" in ev["DESCRIPTION"]


def test_uk_time_follows_british_summer_time():
    assert cf.london_hhmm(datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc)) == "10:00"   # summer
    assert cf.london_hhmm(datetime(2026, 12, 1, 9, 0, tzinfo=timezone.utc)) == "09:00"  # winter
    # the clocks go back at 01:00 UTC on Sunday 25 October 2026
    assert cf.london_hhmm(datetime(2026, 10, 25, 0, 59, tzinfo=timezone.utc)) == "01:59"
    assert cf.london_hhmm(datetime(2026, 10, 25, 1, 0, tzinfo=timezone.utc)) == "01:00"
    # and forward at 01:00 UTC on Sunday 29 March 2026
    assert cf.london_hhmm(datetime(2026, 3, 29, 0, 59, tzinfo=timezone.utc)) == "00:59"
    assert cf.london_hhmm(datetime(2026, 3, 29, 1, 0, tzinfo=timezone.utc)) == "02:00"


def test_travel_time_is_only_added_when_asked_and_does_not_count_as_busy():
    l = lesson(travel_minutes=15)
    assert "travel-l1@adipro.app" not in events(build([l]))
    t = events(build([l], include_travel=True))["travel-l1@adipro.app"]
    assert t["DTSTART"] == "20261022T084500Z" and t["DTEND"] == "20261022T090000Z"
    assert t["SUMMARY"] == "Travel to Sam Smith" and t["TRANSP"] == "TRANSPARENT"
    assert "travel-l1@adipro.app" not in events(build([lesson(travel_minutes=0)], include_travel=True))


def test_blocked_time_shows_only_the_category_never_the_reason():
    b = {"id": "b1", "starts_at": "2026-10-23T09:00:00+00:00", "ends_at": "2026-10-23T12:00:00+00:00", "all_day": False,
         "category": "annual_leave", "reason": "Hospital appointment for my mother"}
    ics = build(blocks=[b])
    ev = events(ics)["block-b1@adipro.app"]
    assert ev["SUMMARY"] == "Not available — Annual leave"
    assert "Hospital" not in ics
    assert ev["DTSTART"] == "20261023T090000Z"


def test_an_all_day_block_uses_dates_with_an_exclusive_end():
    b = {"id": "b2", "starts_at": "2026-10-23T00:00:00+01:00", "ends_at": "2026-10-25T00:00:00+01:00", "all_day": True, "category": "holiday"}
    ev = events(build(blocks=[b]))["block-b2@adipro.app"]
    assert ev["DTSTART;VALUE=DATE"] == "20261023" and ev["DTEND;VALUE=DATE"] == "20261025"


def test_a_bad_block_or_lesson_is_skipped_not_fatal():
    ics = build([lesson(start_time="garbage")], [{"id": "x", "starts_at": "nope", "ends_at": "nope"}, {"id": "y", "starts_at": "2026-10-23T10:00:00Z", "ends_at": "2026-10-23T09:00:00Z"}])
    assert events(ics) == {}
    assert ics.startswith("BEGIN:VCALENDAR") and ics.rstrip().endswith("END:VCALENDAR")


def test_the_header_names_the_calendar_and_hints_at_hourly_refresh():
    ics = build()
    assert "X-WR-CALNAME:DualControl — Jon Kenny" in ics
    assert "REFRESH-INTERVAL;VALUE=DURATION:PT1H" in ics and "X-PUBLISHED-TTL:PT1H" in ics
    assert "X-WR-TIMEZONE:Europe/London" in ics
    assert ics.count("\r\n") == len(ics.split("\r\n")) - 1  # every line ends CRLF


def test_text_is_escaped_so_a_pupil_cannot_inject_calendar_lines():
    ics = build([lesson(notes="a,b;c\nBEGIN:VEVENT\nSUMMARY:x", students={"full_name": "Eve\r\nBEGIN:VEVENT"})])
    lines = ics.replace("\r\n ", "").split("\r\n")
    assert lines.count("BEGIN:VEVENT") == 1          # only the real event starts a line with it
    assert not any(ln.startswith("SUMMARY:x") for ln in lines)
    assert "\\n" in ics


def test_long_lines_fold_at_75_octets_without_splitting_a_character():
    ics = build([lesson(notes="é—" * 80)])
    for line in ics.split("\r\n"):
        assert len(line.encode("utf-8")) <= 75
    assert "é—" * 80 in events(ics)["lesson-l1@adipro.app"]["DESCRIPTION"].replace("\\", "")  # unfolds back intact


def test_folding_a_short_line_changes_nothing():
    assert cf.ics_fold("SUMMARY:short") == "SUMMARY:short"
