"""Invitation mail through the operator's SMTP server.

Off until the operator enters a server: the link to copy is always enough. Nothing else is ever mailed, apart from
the operator's test mail. Both go out in the language of whoever receives it (Prüfgang 05.10.2026, decision 8): the
receiver's account language, else their browser's at the last sign-in; else whoever sends the mail off (their account,
their page, their browser); else the instance's, which is its first operator's; else English. The invitation names who
invites and into which space, and carries the link.
"""

from __future__ import annotations

import logging
import re
import smtplib
import ssl
import unicodedata
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import OPERATOR, Account
from ..security import decrypt_secret
from . import settings_service

logger = logging.getLogger("nexcanvas.mail")

TIMEOUT = 15
SECURITY = ("starttls", "tls", "none")


class MailError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def configured(db: Session) -> bool:
    values = settings_service.get_all(db)
    return bool(values["smtp_host"] and values["smtp_from"])


def _send(db: Session, message: EmailMessage) -> None:
    values = settings_service.get_all(db)
    if not (values["smtp_host"] and values["smtp_from"]):
        raise MailError("mail_off", "No mail server is set up.")
    host = str(values["smtp_host"])
    port = int(values["smtp_port"])
    security = str(values["smtp_security"])
    message["From"] = str(values["smtp_from"])
    message["Message-ID"] = make_msgid(domain=str(values["smtp_from"]).rpartition("@")[2] or None)
    context = ssl.create_default_context()
    try:
        if security == "tls":
            server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=TIMEOUT, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=TIMEOUT)
        with server:
            if security == "starttls":
                server.starttls(context=context)
            user = str(values["smtp_user"])
            if user:
                server.login(user, decrypt_secret(str(values["smtp_password_enc"])))
            server.send_message(message)
    except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
        # The reason goes to the log by its kind only: an SMTP answer can quote the address or the credentials.
        logger.warning("Mail not sent host=%s reason=%s", host, type(exc).__name__)
        raise MailError("mail_failed", "The mail server did not take the mail.") from exc
    logger.info("Mail sent host=%s", host)


#: The mail texts nexcanvas has; any other language gets the English ones.
INVITE_MAIL = {
    "de": {
        "subject": "{by} lädt dich zu nexcanvas ein",
        "where": "in den Bereich „{space}“ in nexcanvas",
        "app": "zu nexcanvas",
        "body": "{by} lädt dich {where} ein. In nexcanvas arbeitet ein Team gemeinsam auf Whiteboards.\n\n"
                "Öffne diesen Link, um die Einladung anzunehmen:\n{link}\n\n"
                "Der Link gilt einmal, {runs}. Wenn du diese Mail nicht erwartet hast, ignoriere sie.\n",
        "until": "bis {day}",
        "days": "ein paar Tage lang",
        "date": "%d.%m.%Y",
    },
    "en": {
        "subject": "{by} invites you to nexcanvas",
        "where": 'to the space "{space}" in nexcanvas',
        "app": "to nexcanvas",
        "body": "{by} invites you {where}, where a team works together on whiteboards.\n\n"
                "Open this link to accept:\n{link}\n\n"
                "The link works once, {runs}. If you did not expect this mail, ignore it.\n",
        "until": "until {day}",
        "days": "for a few days",
        "date": "%Y-%m-%d",
    },
}

TEST_MAIL = {
    "de": {"subject": "nexcanvas: Testmail", "body": "Der Mailserver in nexcanvas funktioniert.\n"},
    "en": {"subject": "nexcanvas test mail", "body": "The mail server in nexcanvas works.\n"},
}

#: The first language of an ``Accept-Language`` header: ``de`` from ``de-DE,de;q=0.9,en;q=0.8``.
_FIRST_LANGUAGE = re.compile(r"\s*([A-Za-z]{2,3})(?:[-_][A-Za-z0-9]{1,8})*\s*(?:[;,]|$)")


def note_browser_language(account: Account, header: str) -> None:
    """Remembers the browser's language at a sign-in, for a mail to the account while it has no language of its own.
    Stored with the session the sign-in starts; a header without a language keeps what was known."""
    found = _FIRST_LANGUAGE.match(header or "")
    if found:
        account.browser_language = found.group(1).lower()


def mail_language(*choices: str | None) -> str:
    """The first of ``choices`` nexcanvas has mail texts for (``de-AT`` counts as ``de``); English otherwise."""
    for choice in choices:
        code = (choice or "").split("-")[0].split("_")[0].strip().lower()
        if code in INVITE_MAIL:
            return code
    return "en"


def languages(account: Account | None, page: str = "") -> tuple[str, ...]:
    """What a person reads, best first: the account's language, the page they are on, their browser at the last
    sign-in."""
    if account is None:
        return (page,)
    return account.language, page, account.browser_language


def instance_languages(db: Session) -> tuple[str, ...]:
    """nexcanvas has no language of its own: the first operator's stands for it (chosen when setting it up)."""
    first = db.scalar(select(Account).where(Account.role == OPERATOR).order_by(Account.id).limit(1))
    return languages(first)


def language_for(db: Session, receiver: Account | None, *fallback: str) -> str:
    """The language of a mail: the receiver's account, else ``fallback`` (whoever sends it off and their page), else
    the instance's, else English."""
    return mail_language(*languages(receiver), *fallback, *instance_languages(db))


def _one_line(text: str) -> str:
    """A name in a mail: one line, no control characters (C0, DEL, C1, line and paragraph separators)."""
    return " ".join("".join(" " if unicodedata.category(char) in {"Cc", "Zl", "Zp"} else char for char in text).split())


def send_invite(db: Session, to: str, link: str, *, by: str, space: str | None, until: date | None = None,
                language: str = "en") -> None:
    words = INVITE_MAIL.get(language, INVITE_MAIL["en"])
    runs = words["until"].format(day=until.strftime(words["date"])) if until else words["days"]
    values = {"by": _one_line(by), "link": link, "runs": runs}
    values["where"] = words["where"].format(space=_one_line(space)) if space else words["app"]
    message = EmailMessage()
    message["To"] = to
    message["Subject"] = words["subject"].format(**values)
    message.set_content(words["body"].format(**values))
    _send(db, message)


def send_test(db: Session, to: str, language: str = "en") -> None:
    words = TEST_MAIL.get(language, TEST_MAIL["en"])
    message = EmailMessage()
    message["To"] = formataddr(("", to))
    message["Subject"] = words["subject"]
    message.set_content(words["body"])
    _send(db, message)
