"""The three lesson-summary endpoints, run for real against a fake database and a fake model: who may use them, what
reaches the model, what gets saved, and who is told. No network."""
import asyncio

import pytest
from fastapi import HTTPException

import lesson_summaries
import server

SB_USER = {"auth_user_id": "auth-instr", "email": "i@example.com", "school": None, "user": {}}
INSTRUCTOR = {"id": "instr-1", "school_id": "school-1", "full_name": "Jon Kenny"}
STUDENT = {"id": "stu-1", "school_id": "school-1", "auth_user_id": "auth-pupil", "full_name": "Maisie Harmer", "email": "m@example.com"}
LESSON = {"id": "les-1", "instructor_id": "instr-1", "student_id": "stu-1", "topic": "Roundabouts", "start_time": "2026-10-22T09:00:00Z", "status": "Completed"}
DICTATION = "Good lesson on roundabouts, still hesitant at the exits but steering is smooth."


class Resp:
    def __init__(self, rows, status=200):
        self._rows, self.status_code, self.text = rows, status, ""

    def json(self):
        return self._rows


class World:
    """What the fake database holds, and what was written to it."""

    def __init__(self):
        self.tier = "pro"
        self.lesson = dict(LESSON)
        self.summaries = []
        self.writes = []
        self.model_calls = []
        self.model_reply = '{"summary": "You did well on roundabouts.", "next_plan": "Practise exits next time."}'
        self.push_tokens = ["ExponentPushToken[x]"]
        self.pushes = []
        self.emails = []


@pytest.fixture
def world(monkeypatch):
    w = World()

    class FakeHttp:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None, params=None):
            table = url.rsplit("/", 1)[-1]
            if table == "lessons":
                return Resp([w.lesson] if params["id"] == f"eq.{w.lesson['id']}" else [])
            if table == "driving_schools":
                return Resp([{"tier": w.tier}])
            if table == "students":
                return Resp([STUDENT])
            if table == "lesson_summaries":
                return Resp(list(w.summaries))
            return Resp([])

        async def post(self, url, headers=None, json=None, params=None):
            w.writes.append(("post", url.rsplit("/", 1)[-1], json))
            return Resp([], 201)

        async def patch(self, url, headers=None, json=None, params=None):
            w.writes.append(("patch", url.rsplit("/", 1)[-1], json))
            return Resp([], 204)

        async def delete(self, url, headers=None, params=None):
            w.writes.append(("delete", url.rsplit("/", 1)[-1], params))
            return Resp([], 204)

    async def instructor(_auth):
        return dict(INSTRUCTOR)

    class FakeMessages:
        async def create(self, **kw):
            w.model_calls.append(kw)

            class Block:
                type = "text"
                text = w.model_reply

            class R:
                content = [Block()]
            return R()

    class FakeAnthropic:
        def __init__(self, *a, **k):
            self.messages = FakeMessages()

    import anthropic
    import lesson_reminders as lr

    async def tokens(_uid):
        return list(w.push_tokens)

    async def send_push(msgs):
        w.pushes.extend(msgs)
        return {"accepted": len(msgs)}

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeHttp)
    monkeypatch.setattr(server, "sb_get_instructor_by_auth_user", instructor)
    monkeypatch.setattr(server, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(anthropic, "AsyncAnthropic", FakeAnthropic)
    monkeypatch.setattr(lr, "_push_tokens_for_user", tokens)
    monkeypatch.setattr(lr, "_send_push", send_push)
    monkeypatch.setattr(server, "_summary_limits", lesson_summaries.DraftLimits())
    monkeypatch.setattr(server, "_sb_headers", lambda: {})
    monkeypatch.setattr(server, "_sb_rest_base", "https://db.example/rest/v1")
    return w


def run(coro):
    return asyncio.run(coro)


def draft(dictation=DICTATION, lesson_id="les-1"):
    return run(server.draft_lesson_summary(lesson_id, server.SummaryDraftRequest(dictation=dictation), SB_USER))


def approve(summary="You did well.", next_plan="Practise exits.", lesson_id="les-1"):
    return run(server.approve_lesson_summary(lesson_id, server.SummaryApproveRequest(summary=summary, next_plan=next_plan), SB_USER))


def status_of(fn):
    with pytest.raises(HTTPException) as e:
        fn()
    return e.value.status_code, e.value.detail


# ---- drafting -------------------------------------------------------------------------------------------------

def test_a_draft_returns_the_summary_and_plan_and_saves_nothing(world):
    r = draft()
    assert r.summary == "You did well on roundabouts."
    assert r.next_plan == "Practise exits next time."
    assert world.writes == []


def test_the_model_sees_only_the_first_name_the_topic_and_the_instructors_words(world):
    draft()
    sent = world.model_calls[0]["messages"][0]["content"]
    assert "Maisie" in sent and "Harmer" not in sent and "m@example.com" not in sent
    assert "Roundabouts" in sent and DICTATION in sent
    assert world.model_calls[0]["model"] == server.AI_MODEL


def test_free_plans_cannot_draft_and_the_model_is_not_called(world):
    world.tier = "free"
    code, detail = status_of(draft)
    assert code == 403 and "Pro plan" in detail
    assert world.model_calls == []


def test_you_cannot_draft_for_someone_elses_lesson(world):
    world.lesson["instructor_id"] = "someone-else"
    assert status_of(draft)[0] == 403
    assert world.model_calls == []


def test_an_unknown_lesson_is_a_404(world):
    assert status_of(lambda: draft(lesson_id="nope"))[0] == 404


def test_too_little_dictation_is_refused_before_anything_else(world):
    code, detail = status_of(lambda: draft("ok"))
    assert code == 400 and "a little more" in detail
    assert world.model_calls == []


def test_an_unreadable_model_reply_is_a_clear_error_not_junk(world):
    world.model_reply = '{"summary": "", "next_plan": ""}{}'
    assert status_of(draft)[0] == 502


def test_drafts_are_rate_limited(world):
    for _ in range(lesson_summaries.DRAFTS_PER_MINUTE):
        draft()
    code, _ = status_of(draft)
    assert code == 429
    assert len(world.model_calls) == lesson_summaries.DRAFTS_PER_MINUTE


# ---- approving ------------------------------------------------------------------------------------------------

def test_approving_saves_the_text_and_tells_the_pupil_by_push_without_the_text(world):
    r = approve()
    assert r.ok and r.notified == "push" and r.updated is False
    kind, table, row = world.writes[0]
    assert (kind, table) == ("post", "lesson_summaries")
    assert row["summary"] == "You did well." and row["next_plan"] == "Practise exits."
    assert row["lesson_id"] == "les-1" and row["student_id"] == "stu-1" and row["instructor_id"] == "instr-1"
    assert world.pushes and "You did well" not in world.pushes[0]["body"]
    assert world.pushes[0]["title"] == "Lesson summary"
    # the notification is recorded so an edit later doesn't tell them again
    assert any(k == "patch" and t == "lesson_summaries" and j.get("notified_channel") == "push" for k, t, j in world.writes)


def test_editing_an_already_sent_summary_updates_it_without_telling_the_pupil_again(world):
    world.summaries = [{"id": "sum-1", "notified_at": "2026-10-22T10:00:00Z"}]
    r = approve(summary="Updated wording.")
    assert r.ok and r.notified is None and r.updated is True
    assert world.pushes == []
    assert world.writes[0][0] == "patch" and world.writes[0][2]["summary"] == "Updated wording."


def test_a_pupil_who_cannot_be_reached_still_gets_the_summary_saved(world, monkeypatch):
    world.push_tokens = []
    import email_service
    monkeypatch.setattr(email_service, "is_configured", lambda: False)
    r = approve()
    assert r.ok and r.notified is None
    assert world.writes[0][0] == "post"


def test_an_empty_or_too_long_summary_is_refused_and_nothing_is_saved(world):
    assert status_of(lambda: approve(summary="   "))[0] == 400
    assert status_of(lambda: approve(summary="a" * (lesson_summaries.MAX_SUMMARY_CHARS + 1)))[0] == 400
    assert world.writes == []


def test_free_plans_cannot_approve_either(world):
    world.tier = "starter"
    assert status_of(approve)[0] == 403
    assert world.writes == []


# ---- withdrawing ----------------------------------------------------------------------------------------------

def test_withdrawing_deletes_the_summary(world):
    r = run(server.withdraw_lesson_summary("les-1", SB_USER))
    assert r.ok
    assert world.writes == [("delete", "lesson_summaries", {"lesson_id": "eq.les-1"})]


# ---- the email for pupils with no app -------------------------------------------------------------------------

def test_the_email_carries_the_summary_and_escapes_names_and_text():
    import email_service
    subject, html_body, text_body = email_service.render_lesson_summary_email(
        student_name="Sam <b>Pupil</b>", instructor_name='Jon "Kenny"',
        summary="You did well.\nKeep mirrors up <script>x</script>", next_plan="Parking next.",
    )
    assert subject == "Your lesson summary from Jon Kenny"
    assert "You did well." in text_body and "Parking next." in text_body and "For your next lesson:" in text_body
    assert "<script>" not in html_body and "<b>" not in html_body
    assert "Hi Sam," in text_body


def test_the_email_leaves_out_the_plan_heading_when_there_is_no_plan():
    import email_service
    _, html_body, text_body = email_service.render_lesson_summary_email(
        student_name="Sam", instructor_name="Jon", summary="Nice one.", next_plan=None,
    )
    assert "For your next lesson" not in text_body and "For your next lesson" not in html_body
