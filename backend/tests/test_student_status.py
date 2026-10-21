from datetime import datetime, timezone

import student_status as s


def test_leaving_passed_clears_the_pass_date_and_progress():
    for new in ("Active", "Test Ready", "Inactive", "Waitlist", "New"):
        assert s.passed_row_patch(new) == {"status": new, "progress": 0, "test_passed_at": None}


def test_staying_passed_changes_nothing_extra():
    assert s.passed_row_patch("Passed") is None


def test_marking_passed_by_hand_sets_progress_and_the_pass_date():
    now = datetime(2026, 10, 22, 9, 30, tzinfo=timezone.utc)
    assert s.becoming_passed_patch(now) == {"status": "Passed", "progress": 100, "test_passed_at": "2026-10-22T09:30:00+00:00"}
