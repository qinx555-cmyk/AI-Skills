# Douyin video extraction notes

## Why not curl/API
- Share-page SSR: `window._SSR_DATA` has `"data":{}`; `window._ROUTER_DATA` only has page/query metadata. No title/desc/stats in HTML.
- `https://www.iesdouyin.com/aweme/v1/web/aweme/detail/?aweme_id=...` and the older
  `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=...` return 403 / empty without signature params (X-Bogus etc.).
- Conclusion: use a real browser session for the page, or a logged-in app.

## Browser reading recipe (in-app browser)
1. Open `https://www.douyin.com/video/<video_id>`.
2. Read body text:
   ```js
   const text = await tab.playwright.evaluate(() => document.body.innerText);
   ```
3. body.innerText contains, in order: danmaku lines → AI "章节要点" (chapter summary + timestamped chapter list) → caption + hashtags → stats (点赞/评论/收藏/转发) → publish date → comment section (top comments) → author card (name, 粉丝/获赞) → related videos.
4. The "章节要点" paragraph plus the timestamped chapter list is the video outline: summarize both with timestamps and source attribution; distinguish AI summaries from verified video content.

## Web cross-verification
- Search: title phrases, hashtags, creator name. Open 网易/搜狐/微博/公众号 reprints.
- Typical useful details found in articles: exact price points (e.g., $9.9/month), volume (e.g., 300+ sites), revenue trajectory, tool names (Claude etc.), time budget, weekly cadence.

## Output conventions
- Default deliverables are HTML with Markdown sources; follow the requesting user’s format preference.
- Label facts: "视频章节要点" vs "公开报道" vs "评论区反馈".
