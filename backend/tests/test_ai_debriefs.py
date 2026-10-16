import ai_debriefs as ad


def f(d=0, s=0, x=0):
    return {"driving": d, "serious": s, "dangerous": x}


ATTEMPT = {
    "passed": False, "driving_faults": 9, "serious_faults": 1, "dangerous_faults": 0,
    "category_breakdown": {
        "controls": f(), "mirrors": f(d=2), "junctions": f(d=3, s=1), "roundabouts": f(d=4),
        "reversing": f(), "use_of_speed": f(),
    },
}


def test_names_known_and_unknown_areas():
    assert ad.category_name("move_off_stop") == "Moving off and stopping"
    assert ad.category_name("pedestrian_crossings") == "Pedestrian crossings"
    assert ad.category_name("some_new_area") == "Some new area"
    assert ad.category_name("") == "Other"


def test_orders_faults_worst_first_and_lists_the_clean_areas():
    rows, clean = ad.faults_by_category(ATTEMPT["category_breakdown"])
    assert [r["name"] for r in rows] == ["Junctions", "Roundabouts", "Mirrors"]  # serious first, then most driving faults
    assert clean == ["Controls", "Reversing", "Use of speed"]


def test_dangerous_beats_serious_beats_driving():
    rows, _ = ad.faults_by_category({"a": f(d=9), "b": f(s=1), "c": f(x=1)})
    assert [r["name"] for r in rows] == ["C", "B", "A"]


def test_tolerates_bad_data():
    assert ad.faults_by_category(None) == ([], [])
    assert ad.faults_by_category("nonsense") == ([], [])
    rows, clean = ad.faults_by_category({"a": "x", "b": {"driving": "lots", "serious": None}, "c": {"driving": -4}, "d": {"driving": 10**9}})
    assert [r["name"] for r in rows] == ["D"] and rows[0]["driving"] == 99  # capped
    assert clean == ["B", "C"]


def test_ignores_anything_past_a_sane_number_of_areas():
    rows, clean = ad.faults_by_category({f"k{i}": f(d=1) for i in range(100)})
    assert len(rows) + len(clean) == ad.MAX_CATEGORIES


def test_the_request_contains_only_what_was_scored():
    system, user = ad.build_mock_debrief_request("Sam Pupil", ATTEMPT)
    assert "Pupil: Sam" in user and "Pupil Sam Pupil" not in user and "Pupil" in user
    assert "Result: FAIL" in user
    assert "Driving faults: 9" in user and "Serious faults: 1" in user and "Dangerous faults: 0" in user
    assert "- Junctions: 1 serious, 3 driving" in user
    assert "- Roundabouts: 4 driving" in user
    assert "Areas with no faults: Controls, Reversing, Use of speed" in user
    assert "Previous attempt" not in user
    assert "second person" in system and "do not invent" in system.lower() and "will or will not pass the real test" in system


def test_includes_the_previous_attempt_for_comparison():
    prev = {"passed": True, "driving_faults": 12, "serious_faults": 0, "dangerous_faults": 0}
    _, user = ad.build_mock_debrief_request("Sam", ATTEMPT, prev)
    assert "Previous attempt: PASS, 12 driving, 0 serious, 0 dangerous faults." in user


def test_a_clean_drive_and_a_missing_name():
    clean = {"passed": True, "driving_faults": 0, "serious_faults": 0, "dangerous_faults": 0, "category_breakdown": {"controls": f()}}
    _, user = ad.build_mock_debrief_request(None, clean)
    assert "Pupil: the pupil" in user
    assert "Result: PASS" in user
    assert "No faults were recorded in any area." in user
    assert "Faults by area" not in user
