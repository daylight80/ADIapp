"""Keep secrets and personal details out of the server logs.

httpx writes every request URL at INFO, and the URLs this server sends to the database carry emails, ids and a school's
secret website-form key. uvicorn's access log prints each request path, which for a school's form address contains
that key. Render keeps these logs, so neither is wanted there."""
import logging
import re

_FORM_KEY = re.compile(r"(/api/public/enquiries/[0-9a-f]{4})[0-9a-f]{28}")


class HideFormKeys(logging.Filter):
    """Shows the first four characters of a form key (enough to tell two apart) and hides the rest."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(_FORM_KEY.sub(r"\1****", a) if isinstance(a, str) else a for a in record.args)
        return True


def install() -> None:
    """Safe to call more than once."""
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)  # warnings and errors still show; request URLs do not
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, HideFormKeys) for f in access.filters):
        access.addFilter(HideFormKeys())
