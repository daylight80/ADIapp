"""Building the request for an AI debrief of a mock driving test (DL25). Pure functions, no network, so the
wording of the request is tested. The model only ever sees the numbers and category names given here."""
import re
from typing import Any, Dict, List, Optional, Tuple

CATEGORY_NAMES = {
    "controls": "Controls",
    "move_off_stop": "Moving off and stopping",
    "mirrors": "Mirrors",
    "signals": "Signals",
    "junctions": "Junctions",
    "roundabouts": "Roundabouts",
    "pedestrian_crossings": "Pedestrian crossings",
    "manoeuvres": "Manoeuvres",
    "reversing": "Reversing",
    "awareness_planning": "Awareness and planning",
    "use_of_speed": "Use of speed",
    "other_road_users": "Other road users",
}

MAX_CATEGORIES = 60  # a real breakdown has about 45 lines (the DL25 items) or 12 (older attempts); more is ignored rather than trusted

SYSTEM_PROMPT = (
    "You write short, encouraging debriefs for UK driving pupils after a mock driving test, based on the "
    "instructor's scored results. Write 3 to 5 short sentences in the second person ('you'), plain and warm, "
    "not clinical. Mention one or two things that went well (areas with no faults, or an improvement on the "
    "previous attempt if one is given), then the one or two areas to practise next, taken from the areas with "
    "the most serious or dangerous faults first, then driving faults. Use only the numbers and areas you are "
    "given and do not invent anything else. Do not say whether they will or will not pass the real test. If "
    "they passed the mock, congratulate them briefly but still name something to polish. Respond with ONLY "
    "the debrief text: no heading, no markdown, no preamble."
)


_LABEL_OK = re.compile(r"[^A-Za-z0-9 /&()\-–,.']")


def clean_label(label: Any) -> str:
    """A name saved with the attempt, reduced to plain words so nothing odd reaches the model. Empty if unusable."""
    if not isinstance(label, str):
        return ""
    return " ".join(_LABEL_OK.sub("", label).split())[:60]


def category_name(key: str, label: Any = None) -> str:
    saved = clean_label(label)
    if saved:
        return saved
    if key in CATEGORY_NAMES:
        return CATEGORY_NAMES[key]
    pretty = str(key).replace("_", " ").strip().capitalize()
    return pretty[:40] or "Other"


def _count(value: Any) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(n, 99))


def faults_by_category(breakdown: Any) -> Tuple[List[Dict[str, Any]], List[str]]:
    """(areas with faults, worst first; names of the areas with none). Tolerates a missing or malformed breakdown."""
    if not isinstance(breakdown, dict):
        return [], []
    with_faults: List[Dict[str, Any]] = []
    clean: List[str] = []
    for key, f in list(breakdown.items())[:MAX_CATEGORIES]:
        if not isinstance(f, dict):
            continue
        d, s, x = _count(f.get("driving")), _count(f.get("serious")), _count(f.get("dangerous"))
        name = category_name(key, f.get("label"))
        if d or s or x:
            with_faults.append({"name": name, "driving": d, "serious": s, "dangerous": x})
        else:
            clean.append(name)
    with_faults.sort(key=lambda r: (-r["dangerous"], -r["serious"], -r["driving"], r["name"]))
    return with_faults, sorted(clean)


def _result(passed: bool) -> str:
    return "PASS" if passed else "FAIL"


def _line(row: Dict[str, Any]) -> str:
    parts = []
    if row["dangerous"]:
        parts.append(f"{row['dangerous']} dangerous")
    if row["serious"]:
        parts.append(f"{row['serious']} serious")
    if row["driving"]:
        parts.append(f"{row['driving']} driving")
    return f"- {row['name']}: {', '.join(parts)}"


def build_mock_debrief_request(
    pupil_first_name: Optional[str],
    attempt: Dict[str, Any],
    previous: Optional[Dict[str, Any]] = None,
) -> Tuple[str, str]:
    """(system prompt, user message) for one attempt, with the previous attempt for comparison when there is one."""
    name = (pupil_first_name or "").strip().split(" ")[0][:40] or "the pupil"
    d, s, x = _count(attempt.get("driving_faults")), _count(attempt.get("serious_faults")), _count(attempt.get("dangerous_faults"))
    rows, clean = faults_by_category(attempt.get("category_breakdown"))
    lines = [
        f"Pupil: {name}",
        f"Result: {_result(bool(attempt.get('passed')))} (a pass is up to 15 driving faults and no serious or dangerous faults)",
        f"Driving faults: {d}",
        f"Serious faults: {s}",
        f"Dangerous faults: {x}",
    ]
    if rows:
        lines += ["", "Faults by area (worst first):"] + [_line(r) for r in rows]
    else:
        lines += ["", "No faults were recorded in any area."]
    if clean and rows:
        lines += ["", "Areas with no faults: " + ", ".join(clean)]
    if previous:
        pd, ps, px = _count(previous.get("driving_faults")), _count(previous.get("serious_faults")), _count(previous.get("dangerous_faults"))
        lines += ["", f"Previous attempt: {_result(bool(previous.get('passed')))}, {pd} driving, {ps} serious, {px} dangerous faults."]
    return SYSTEM_PROMPT, "\n".join(lines)
