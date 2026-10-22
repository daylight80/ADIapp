import pytest

import lesson_summaries as ls


def test_only_paid_tiers_can_draft():
    assert ls.is_paid_tier("pro") and ls.is_paid_tier("Franchise")
    for t in (None, "", "free", "starter", "growth", 5):
        assert not ls.is_paid_tier(t)


def test_dictation_must_be_long_enough_and_not_too_long():
    with pytest.raises(ValueError, match="a little more"):
        ls.validate_dictation("too short")
    with pytest.raises(ValueError, match="too long"):
        ls.validate_dictation("a" * (ls.MAX_DICTATION_CHARS + 5))
    assert ls.validate_dictation("  Good lesson on roundabouts,\n\n\n\nstill hesitant at exits.  ") == "Good lesson on roundabouts,\n\nstill hesitant at exits."
    assert ls.validate_dictation(None if False else "x" * 20) == "x" * 20


def test_control_characters_are_removed_from_text():
    assert ls.clean_text("hello\x00 wor\x07ld", 50) == "hello world"
    assert ls.clean_text(123, 10) == ""


def test_the_request_names_only_the_first_name_the_topic_and_the_words_spoken():
    system, user = ls.build_request("Maisie Harmer", "Roundabouts", "Did well, nervous at the exit.")
    assert "Maisie" in user and "Harmer" not in user
    assert "Roundabouts" in user and "Did well, nervous at the exit." in user
    assert "do not invent" in system.lower() and "pass their test" in system.lower()


def test_odd_names_and_topics_are_made_safe():
    _, user = ls.build_request("<script>Bob</script> Smith", None, "x" * 20)
    assert "<" not in user.split("\n")[0]
    assert "General lesson" in user
    _, user2 = ls.build_request(None, "t" * 500, "x" * 20)
    assert "the pupil" in user2 and len(user2.split("Lesson topic: ")[1].split("\n")[0]) <= 80


def test_reads_the_json_reply():
    d = ls.parse_draft('{"summary": "You did well.", "next_plan": "Practise exits."}')
    assert d == {"summary": "You did well.", "next_plan": "Practise exits."}


def test_reads_a_fenced_or_wordy_reply():
    assert ls.parse_draft('```json\n{"summary": "A", "next_plan": "B"}\n```') == {"summary": "A", "next_plan": "B"}
    assert ls.parse_draft('Here you go: {"summary": "A", "next_plan": "B"} Hope that helps') == {"summary": "A", "next_plan": "B"}


def test_falls_back_to_plain_text_as_the_summary():
    assert ls.parse_draft("Just a plain note.") == {"summary": "Just a plain note.", "next_plan": ""}


def test_an_empty_reply_is_an_error():
    for bad in ("", None, "   ", '{"summary": "", "next_plan": ""}{}'):
        # an object with an empty summary is not usable; the plain-text fallback strips braces and finds nothing
        with pytest.raises(ValueError):
            ls.parse_draft(bad)


def test_approved_text_is_checked_and_a_blank_plan_becomes_none():
    assert ls.validate_approved("  Nice work. ", "") == ("Nice work.", None)
    assert ls.validate_approved("Nice", "Next: parking") == ("Nice", "Next: parking")
    with pytest.raises(ValueError, match="empty"):
        ls.validate_approved("   ", "x")
    with pytest.raises(ValueError, match="too long"):
        ls.validate_approved("a" * (ls.MAX_SUMMARY_CHARS + 1), None)
    with pytest.raises(ValueError, match="too long"):
        ls.validate_approved("ok", "a" * (ls.MAX_PLAN_CHARS + 1))


def test_the_push_never_contains_the_summary():
    m = ls.push_message("Jon Kenny")
    assert m["title"] == "Lesson summary"
    assert m["body"].startswith("Jon ")
    assert "Open the app" in m["body"]
    assert ls.push_message(None)["body"].startswith("Your ")


def test_drafts_are_capped_per_instructor_per_minute_and_per_day():
    now = [0.0]
    lim = ls.DraftLimits(clock=lambda: now[0])
    assert all(lim.allow("u1") for _ in range(ls.DRAFTS_PER_MINUTE))
    assert not lim.allow("u1")          # burst reached
    assert lim.allow("u2")              # someone else is unaffected
    total = ls.DRAFTS_PER_MINUTE
    while total < ls.DRAFTS_PER_DAY:
        now[0] += 61                    # a new minute each time
        for _ in range(ls.DRAFTS_PER_MINUTE):
            if total >= ls.DRAFTS_PER_DAY:
                break
            assert lim.allow("u1")
            total += 1
    now[0] += 61
    assert not lim.allow("u1")          # the day's cap
