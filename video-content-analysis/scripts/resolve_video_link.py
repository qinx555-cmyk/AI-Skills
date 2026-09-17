#!/usr/bin/env python3
"""Resolve a short-video share link to its final URL and video ID.

Usage:
    python3 resolve_video_link.py <share-url>

Prints: final_url, video_id, platform.
Supports Douyin short links (v.douyin.com/xxx), douyin.com/video/<id>,
iesdouyin.com share pages; falls back gracefully for other platforms.
"""
import re
import sys
import urllib.error
import urllib.request

UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")


def resolve(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.geturl()
    except urllib.error.HTTPError as e:
        return e.geturl() or url
    except Exception as e:  # noqa: BLE001 - report any network issue clearly
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


def extract_id(url: str) -> str | None:
    for pat in (r"/(?:video|share/video)/(\d+)", r"[?&]video_id=(\d+)", r"(\d{15,20})"):
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


def platform_of(url: str) -> str:
    if "douyin.com" in url or "iesdouyin.com" in url:
        return "douyin"
    if "bilibili.com" in url or "b23.tv" in url:
        return "bilibili"
    if "xiaohongshu.com" in url or "xhslink.com" in url:
        return "xiaohongshu"
    return "unknown"


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    final = resolve(sys.argv[1])
    print(f"final_url: {final}")
    print(f"video_id: {extract_id(final)}")
    print(f"platform: {platform_of(final)}")
