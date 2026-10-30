"""A school's secret form key, and the URLs of database calls, stay out of the server logs. No network."""
import logging
import re

import log_hygiene

KEY = "0123456789abcdef0123456789abcdef"


def access_record(path):
    # The shape uvicorn gives its access logger: client, method, path, http version, status.
    return logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d', ("1.2.3.4:0", "POST", path, "1.1", 200), None)


def test_the_access_log_shows_only_the_start_of_a_form_key():
    record = access_record(f"/api/public/enquiries/{KEY}")
    assert log_hygiene.HideFormKeys().filter(record) is True  # the line is still logged
    line = record.getMessage()
    # Four characters, the stars, and then nothing that looks like more of the key.
    assert re.search(r"/api/public/enquiries/0123\*{4}(?![0-9a-f])", line)
    assert not any(KEY[i:i + 6] in line for i in range(4, len(KEY) - 5)), "part of the key is still showing"
    assert '1.2.3.4:0 - "POST ' in line and line.endswith("200")


def test_other_paths_and_non_text_arguments_are_left_alone():
    record = access_record("/api/v2/students/invite")
    log_hygiene.HideFormKeys().filter(record)
    assert record.getMessage() == '1.2.3.4:0 - "POST /api/v2/students/invite HTTP/1.1" 200'
    other = logging.LogRecord("x", logging.INFO, "", 0, "no arguments at all", None, None)
    assert log_hygiene.HideFormKeys().filter(other) is True and other.getMessage() == "no arguments at all"


def test_a_get_for_the_hosted_page_and_a_query_string_are_hidden_too():
    record = access_record(f"/api/public/enquiries/{KEY}?x=1")
    log_hygiene.HideFormKeys().filter(record)
    assert re.search(r"/api/public/enquiries/0123\*{4}\?x=1", record.getMessage())


def test_a_key_in_the_middle_of_a_longer_message_is_hidden():
    record = logging.LogRecord("x", logging.INFO, "", 0, "asked %s", (f"/api/public/enquiries/{KEY}",), None)
    log_hygiene.HideFormKeys().filter(record)
    assert not any(KEY[i:i + 6] in record.getMessage() for i in range(4, len(KEY) - 5))


def test_installing_quiets_the_database_request_logging_and_adds_the_filter_once():
    log_hygiene.install()
    log_hygiene.install()
    assert not logging.getLogger("httpx").isEnabledFor(logging.INFO)
    assert logging.getLogger("httpx").isEnabledFor(logging.WARNING)  # problems still show
    assert not logging.getLogger("httpcore").isEnabledFor(logging.INFO)
    assert sum(isinstance(f, log_hygiene.HideFormKeys) for f in logging.getLogger("uvicorn.access").filters) == 1


def test_the_server_installs_it_when_it_starts():
    # In a fresh process, so nothing another test has done to the loggers can hide a missing call.
    import os
    import subprocess
    import sys
    code = (
        "import logging, server, log_hygiene;"
        "print(logging.getLogger('httpx').isEnabledFor(logging.INFO),"
        " any(isinstance(f, log_hygiene.HideFormKeys) for f in logging.getLogger('uvicorn.access').filters))"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=120,
                         cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    assert out.stdout.strip().splitlines()[-1] == "False True", out.stderr[-500:]
