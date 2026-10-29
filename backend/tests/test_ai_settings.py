"""The two AI features (receipt scanner, lesson debrief) share one model and one set of request settings.
These tests check those settings, and that the installed Anthropic SDK really sends them, without calling
Anthropic."""
import asyncio
import json

import anthropic
import httpx2 as httpx  # the Anthropic SDK 1.x uses httpx2, not httpx

import server


def test_both_features_use_haiku_5_5_at_low_effort_with_room_to_answer():
    assert server.AI_MODEL == "claude-haiku-5-5"
    assert server.AI_OUTPUT_CONFIG == {"effort": "low"}
    # Thinking tokens count against max_tokens, so leave plenty of room after them.
    assert server.AI_MAX_TOKENS >= 500


def test_the_sdk_sends_the_model_and_effort(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": server.AI_MODEL,
            "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        })

    async def run():
        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        client = anthropic.AsyncAnthropic(api_key="test", http_client=http)
        return await client.messages.create(
            model=server.AI_MODEL, max_tokens=server.AI_MAX_TOKENS, output_config=server.AI_OUTPUT_CONFIG,
            system="s", messages=[{"role": "user", "content": "hi"}],
        )

    response = asyncio.run(run())
    assert response.content[0].text == "ok"
    assert seen["body"]["model"] == "claude-haiku-5-5"
    assert seen["body"]["output_config"] == {"effort": "low"}
    assert seen["body"]["max_tokens"] == server.AI_MAX_TOKENS
    assert "temperature" not in seen["body"]  # Haiku 5.5 refuses non-default sampling settings


def test_the_requirements_pin_allows_the_sdk_version_that_supports_effort():
    """The `effort` setting needs SDK 1.8 or newer, so the pin must stay at that or above, and stop before the next major."""
    import re

    reqs = open("requirements.txt", encoding="utf-8").read()
    m = re.search(r"^anthropic>=(\d+)\.(\d+)(?:\.\d+)?,<(\d+)\s*$", reqs, re.MULTILINE)
    assert m, "requirements.txt should pin anthropic as >=X.Y,<next major"
    assert (int(m.group(1)), int(m.group(2))) >= (1, 8)
    assert int(m.group(3)) == int(m.group(1)) + 1
