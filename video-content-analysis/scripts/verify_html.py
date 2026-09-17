#!/usr/bin/env python3
"""Structural checks on generated self-contained HTML.

Usage:
    python3 verify_html.py <file.html>

Exits 0 (PASS) if the file has the required skeleton and no obvious
structural problems; prints issues and exits 1 otherwise.
"""
import html.parser
import re
import sys


class Checker(html.parser.HTMLParser):
    VOID = {
        "meta", "br", "hr", "img", "input", "link",
        "line", "rect", "path", "text", "marker",
        "circle", "polyline", "polygon", "stop",
    }

    def __init__(self):
        super().__init__()
        self.stack = []
        self.errors = []

    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(f"mismatched </{tag}> (stack tail: {self.stack[-3:]})")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    path = sys.argv[1]
    data = open(path, encoding="utf-8").read()
    ok = True

    c = Checker()
    c.feed(data)
    if c.errors:
        ok = False
        print("TAG ERRORS:")
        for e in c.errors[:20]:
            print("  ", e)
    if c.stack:
        ok = False
        print("UNCLOSED TAGS:", c.stack)

    for tag in ("<!DOCTYPE html>", "<style>", "<body>"):
        if tag not in data:
            ok = False
            print("MISSING SKELETON:", tag)

    leftovers = re.findall(r"\*\*|```", data)
    if leftovers:
        ok = False
        print("LEFTOVER MARKDOWN:", leftovers[:10])

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
