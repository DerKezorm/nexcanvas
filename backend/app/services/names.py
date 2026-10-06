"""Names typed here: no control characters (Prüfgang 05.10.2026 A13, as in nexbrand and nexsuite).

A name of a space, a team, a board or a template is one line. Before, only C0 was refused; DEL and C1 (U+0080 to
U+009F, the escape that colours a terminal among them) went into the database and on into the log and exports.
Format characters (Cf) stay allowed here: an emoji with a joiner or a Persian name with a non-joiner is a fair name
for a board. Display names refuse them too (``routers/auth.py``), so nobody reads as somebody else.
"""

from __future__ import annotations

import unicodedata

#: The blanks a pasted name may hold: they are gathered into one space, never stored.
BLANKS = "\t\n\r"
#: The answer when a name holds one (code ``invalid_characters``): a length alone said nothing about it.
CONTROL_TEXT = "The text contains control characters you cannot see."


def has_control(text: str, keep: str = BLANKS) -> bool:
    """A control character (Unicode Cc: C0, DEL and C1) other than those in ``keep``. Also those Python counts as
    blanks (U+001C to U+001F, U+0085): ``split`` would hide them instead of refusing them."""
    return any(unicodedata.category(char) == "Cc" and char not in keep for char in text)
