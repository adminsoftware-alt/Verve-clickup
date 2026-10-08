"""A throwaway SMTP server that prints what the app tried to send, instead of sending it.

Email is the one feature you cannot check by reading the code: everything compiles, every job
runs, and you still do not know whether a real message with real content comes out of the other
end. This listens on a port, accepts whatever the app hands it, and prints the envelope and the
words of every message. Nothing leaves the machine.

    1. Run it:        python scripts/catch_mail.py
    2. Put this in backend/.env:

           SMTP_HOST=localhost
           SMTP_PORT=8025
           SMTP_FROM=verve@localhost
           SMTP_STARTTLS=false

    3. Restart the backend, then send something -- Admin -> Email -> "Send a test", an invitation,
       or `python scripts/run_email_jobs.py`.

Stop it with Ctrl-C.

It speaks only the handful of SMTP verbs the app uses. Python's own `smtpd` would have done the
job until 3.12 removed it, and a dependency for a debugging script is a dependency in production's
requirements file, so this is a socket and a loop.
"""

import re
import socket
import sys
import threading
from email import message_from_bytes
from email.policy import default

PORT = 8025
caught = 0
lock = threading.Lock()

# A Windows console is cp1252, and an email full of arrows and dashes is not. Without this the
# print raises, the thread handling that connection dies, the socket closes in the middle of DATA,
# and the app reports a perfectly good message as unsendable -- which looks exactly like a broken
# mailer and sends you hunting in the wrong place.
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass


def readable(html_text: str) -> str:
    """Enough of a strip to read an email in a terminal. Not a parser, and does not need to be."""
    text = re.sub(r"<br\s*/?>|</p>|</tr>|</div>|</h\d>", "\n", html_text, flags=re.I)
    # Round brackets, not angle: the tag-stripper on the next line removes anything between < and
    # >, and would otherwise eat the URL this line has just gone to the trouble of pulling out.
    text = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', r"\2 (\1)", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", "", text)
    for entity, char in (("&nbsp;", " "), ("&amp;", "&"), ("&quot;", '"'), ("&#x27;", "'"),
                         ("&middot;", "·"), ("&lt;", "<"), ("&gt;", ">")):
        text = text.replace(entity, char)
    return re.sub(r"\n{3,}", "\n\n", text)


def show(sender: str, recipients: list, raw: bytes) -> None:
    global caught
    message = message_from_bytes(raw, policy=default)
    body = message.get_body(preferencelist=("html", "plain"))
    content = body.get_content() if body else "(no body)"
    with lock:
        caught += 1
        print("\n" + "=" * 78)
        print(f"#{caught}  from {sender}  to {', '.join(recipients)}")
        print(f"subject: {message['Subject']}")
        print("-" * 78)
        for line in readable(content).splitlines():
            if line.strip():
                print("   " + line.strip())
        print("=" * 78, flush=True)


def serve(conn: socket.socket) -> None:
    """One conversation: greet, take the envelope, take the message, say thank you."""
    f = conn.makefile("rwb")

    def say(line: str) -> None:
        f.write(f"{line}\r\n".encode())
        f.flush()

    sender, recipients = "", []
    say("220 localhost Verve mail catcher")
    try:
        while True:
            raw = f.readline()
            if not raw:
                return
            line = raw.decode("utf-8", "replace").strip()
            upper = line.upper()
            if upper.startswith(("HELO", "EHLO")):
                # No extensions offered: no STARTTLS, no AUTH, so the client cannot ask for either.
                say("250 localhost")
            elif upper.startswith("MAIL FROM"):
                sender = line.partition(":")[2].strip().strip("<>")
                say("250 OK")
            elif upper.startswith("RCPT TO"):
                recipients.append(line.partition(":")[2].strip().strip("<>"))
                say("250 OK")
            elif upper == "DATA":
                say("354 End with a line of a single dot")
                chunks = []
                while True:
                    part = f.readline()
                    if not part or part in (b".\r\n", b".\n"):
                        break
                    chunks.append(part[1:] if part.startswith(b"..") else part)
                try:
                    show(sender, recipients, b"".join(chunks))
                except Exception as exc:  # noqa: BLE001 - printing must never fail a delivery
                    print(f"(caught a message, but could not print it: {exc!r})", flush=True)
                sender, recipients = "", []
                say("250 Caught")
            elif upper == "RSET":
                sender, recipients = "", []
                say("250 OK")
            elif upper == "NOOP":
                say("250 OK")
            elif upper == "QUIT":
                say("221 Bye")
                return
            else:
                say("502 Not implemented here")
    except (ConnectionError, OSError):
        return
    finally:
        try:
            f.close()
            conn.close()
        except OSError:
            pass


def main() -> None:
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", PORT))
    server.listen(16)
    print(f"Catching mail on localhost:{PORT}. Nothing is sent anywhere. Ctrl-C to stop.\n")
    print("Put this in backend/.env, then restart the backend:")
    print("  SMTP_HOST=localhost")
    print(f"  SMTP_PORT={PORT}")
    print("  SMTP_FROM=verve@localhost")
    print("  SMTP_STARTTLS=false\n", flush=True)
    try:
        while True:
            conn, _ = server.accept()
            threading.Thread(target=serve, args=(conn,), daemon=True).start()
    except KeyboardInterrupt:
        print(f"\nStopped. {caught} message(s) caught.")
    finally:
        server.close()


if __name__ == "__main__":
    main()
