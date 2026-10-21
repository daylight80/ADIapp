"""What changing a pupil's status does besides the status itself.

Marking a pupil Passed also sets their progress to 100 and stamps the pass date. If that was a mistake (or the
instructor simply needs to change a pupil's status by hand), moving them off Passed has to undo those two
things, otherwise they would sit at "Active" with 100% progress and a pass date.
"""
from datetime import datetime, timezone
from typing import Optional

PASSED = "Passed"


def passed_row_patch(new_status: str) -> Optional[dict]:
    """The update for a pupil who is *currently Passed* moving to `new_status`, or None if they stay Passed."""
    if new_status == PASSED:
        return None
    return {"status": new_status, "progress": 0, "test_passed_at": None}


def becoming_passed_patch(now: Optional[datetime] = None) -> dict:
    """The update for a pupil who is *not yet Passed* being marked Passed by hand."""
    stamp = (now or datetime.now(timezone.utc)).isoformat()
    return {"status": PASSED, "progress": 100, "test_passed_at": stamp}
