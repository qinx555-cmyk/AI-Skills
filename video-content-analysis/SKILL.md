---
name: video-content-analysis
description: "Analyze a short-video share link (especially Douyin: v.douyin.com/xxx or douyin.com/video/ID) to extract its actual content—title/caption, AI chapter summaries, statistics, comments—organize the key points / money-making path, cross-verify with web sources, and deliver a structured breakdown plus an actionable plan (Markdown + self-contained HTML). Use when the user pastes a video link and asks to 解析/总结/整理 this video, asks 视频里怎么赚钱 / 整理赚钱路径, or wants a business/monetization breakdown of a video."
---

# Video Content Analysis

## Workflow

1. **Resolve the share link**
   - Run `scripts/resolve_video_link.py <share-url>` to get the final URL and video ID.
   - Needs network; in a sandboxed environment this may require escalated permissions.

2. **Extract page content in a browser** (do not rely on curl/APIs alone)
   - Douyin share pages ship NO video description in SSR HTML (`window._SSR_DATA` data is empty) and the detail API requires signatures (returns 403/empty). A real browser is often useful; page layouts and access requirements can change.
   - Open `https://www.douyin.com/video/<ID>` in the in-app browser, then read `document.body.innerText`.
   - Extract and record:
     - title/caption + hashtags;
     - **AI "章节要点" (chapter summaries with timestamps)** — the most valuable content: it is the video's structure/outline;
     - stats (likes / comments / favorites / shares), publish date;
     - author name + follower/like counts;
     - top comments and danmaku (real user feedback, often highlights pain points/skepticism).

3. **Cross-verify with web search**
   - Search distinctive phrases (title, hashtags, creator name) and read the top articles (sohu / 163 / weibo / 公众号转载) via `open_page`.
   - Separate "as stated in the video" facts (from chapter summaries) from "as reported" numbers (articles); label the source of each.

4. **Organize the money path / key points**
   - Derive the flow from the actual video. For website businesses, an example is `需求发现 → 建站 → 上线 → 引流 → 变现 → 批量复制`.
   - List every monetization channel with concrete numbers, and explicitly note what the video did NOT say (gaps, risks, 幸存者偏差, regional tool-access issues).
   - Include the honest "caveats" section: hardest step (traffic), source-supported timelines, gray-hat risks, and skepticism from comments.

5. **Deliverables** (default: HTML, keep .md)
   - `01-<主题>拆解`: video facts, chapter timeline, path diagram (mermaid), monetization breakdown, sources.
   - `02-<主题>落地方案`: tooling (with regional workarounds), selection SOP, step-by-step workflow, roadmap/budget, reusable prompt templates, risk checklist.
   - Convert each with bundled `python3 scripts/md_to_html.py <input.md> <output.html>`, then run `python3 scripts/verify_html.py <output.html>`. No separately installed HTML skill is required. Respect explicit requests for a shorter summary or a different output format.
   - If page content is unavailable, report the gap and request a transcript or accessible source; do not invent the video content.

## Key gotchas
- Chapter summaries are AI-generated; individual names/figures may be slightly off—cross-check.
- "年入百万" style claims are head-case results, not beginner expectations; keep expectations honest in the plan.
- `file://` URLs are blocked in the in-app browser; preview generated HTML via a local HTTP server instead.

## Reference
- `references/douyin-extraction.md` — extraction details, API failure modes, and the browser-reading recipe.
