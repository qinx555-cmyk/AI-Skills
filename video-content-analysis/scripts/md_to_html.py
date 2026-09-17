#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert Markdown to a self-contained HTML file.

Usage:
    python3 md_to_html.py <input.md> [output.html]

- Default output: same basename as input with .html, in the same directory.
- The source .md is never modified.
- Supported Markdown: headings, paragraphs, tables, bullet/ordered/task
  lists, blockquotes, fenced code blocks, horizontal rules, inline code,
  **bold**, [links](url).
- Mermaid flowchart LR/TD fenced blocks are pre-rendered into inline SVG
  (no JavaScript, no CDN) so the HTML is fully self-contained/offline.
"""
import html
import re
import sys
import unicodedata
from collections import defaultdict, deque

# ---------------------------------------------------------------- markdown

CSS = """
:root{--accent:#2563eb;--ink:#1e293b;--muted:#64748b;--line:#e5e7eb;--bg:#f8fafc;}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Segoe UI',sans-serif;line-height:1.75;font-size:16px;}
.page{max-width:900px;margin:0 auto;padding:40px 28px 80px;}
article{background:#fff;border:1px solid var(--line);border-radius:14px;padding:44px 52px;box-shadow:0 1px 3px rgba(15,23,42,.06);}
h1{font-size:27px;line-height:1.4;margin:0 0 6px;color:#0f172a;border-bottom:3px solid var(--accent);padding-bottom:14px;}
h2{font-size:21px;margin:38px 0 12px;color:#0f172a;padding-left:12px;border-left:5px solid var(--accent);}
h3{font-size:17px;margin:26px 0 10px;color:#1e293b;}
h4{font-size:15.5px;margin:20px 0 8px;color:#334155;}
p{margin:10px 0;}
strong{color:#0f172a;}
a{color:var(--accent);text-decoration:none;}
a:hover{text-decoration:underline;}
hr{border:none;border-top:1px solid var(--line);margin:28px 0;}
blockquote{margin:14px 0;padding:12px 18px;background:#f1f5f9;border-left:4px solid #94a3b8;border-radius:0 8px 8px 0;color:#334155;}
ul,ol{margin:8px 0 14px;padding-left:26px;}
li{margin:5px 0;}
li.task{list-style:none;margin-left:-20px;display:flex;gap:8px;align-items:flex-start;}
li.task input{margin-top:6px;accent-color:var(--accent);}
code{background:#eef2f7;border:1px solid #e2e8f0;border-radius:5px;padding:1px 6px;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:.88em;color:#0f172a;}
pre.code{background:#0f172a;color:#e2e8f0;border-radius:10px;padding:16px 20px;overflow-x:auto;font-size:13.5px;line-height:1.6;}
pre.code code{background:none;border:none;color:inherit;padding:0;}
.table-wrap{overflow-x:auto;margin:16px 0;border:1px solid var(--line);border-radius:10px;}
table{border-collapse:collapse;width:100%;font-size:14.5px;background:#fff;}
th{background:#f1f5f9;color:#0f172a;text-align:left;padding:10px 14px;border-bottom:2px solid var(--line);white-space:nowrap;}
td{padding:10px 14px;border-bottom:1px solid var(--line);vertical-align:top;}
tbody tr:nth-child(even){background:#f8fafc;}
tbody tr:last-child td{border-bottom:none;}
footer{text-align:center;color:var(--muted);font-size:13px;margin-top:24px;}
@media (max-width:640px){article{padding:28px 20px;}.page{padding:16px 10px 60px;}h1{font-size:22px;}h2{font-size:18px;}}
@media print{body{background:#fff;}.page{max-width:none;}article{border:none;box-shadow:none;}}
"""


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def inline(s: str) -> str:
    s = esc(s)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', s)
    return s


def is_table_row(line: str) -> bool:
    s = line.strip()
    return s.startswith("|") and s.endswith("|")


def parse_table(rows):
    head = [c.strip() for c in rows[0].strip().strip("|").split("|")]
    body = []
    for r in rows[1:]:
        cells = [c.strip() for c in r.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
            continue
        body.append(cells)
    h = "<thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head) + "</tr></thead>"
    b = "<tbody>" + "".join(
        "<tr>" + "".join(f"<td>{inline(c)}</td>" for c in row) + "</tr>" for row in body
    ) + "</tbody>"
    return f'<div class="table-wrap"><table>{h}{b}</table></div>'


def convert(md_text: str) -> str:
    lines = md_text.splitlines()
    out = []
    list_stack = []  # (tag, level)

    def close_lists(level: int):
        while list_stack and list_stack[-1][1] >= level:
            tag, _ = list_stack.pop()
            out.append(f"</{tag}>")

    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            buf = []
            i += 1
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            code = "\n".join(buf).strip("\n")
            if lang == "mermaid":
                out.append(render_mermaid(code))
            else:
                out.append('<pre class="code"><code>' + esc(code) + "</code></pre>")
            continue

        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            close_lists(0)
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        if stripped == "---":
            close_lists(0)
            out.append("<hr/>")
            i += 1
            continue

        if is_table_row(line):
            close_lists(0)
            rows = []
            while i < n and is_table_row(lines[i]):
                rows.append(lines[i])
                i += 1
            out.append(parse_table(rows))
            continue

        if stripped.startswith(">"):
            close_lists(0)
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip()[1:].strip())
                i += 1
            out.append("<blockquote>" + "<br/>".join(inline(x) for x in buf if x) + "</blockquote>")
            continue

        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)$", line)
        if m:
            indent = len(m.group(1).replace("\t", "  "))
            level = indent // 2
            content = m.group(3)
            is_ul = m.group(2) in ("-", "*")
            cm = re.match(r"^\[( |x|X)\]\s+(.*)$", content)
            if cm:
                checked = " checked" if cm.group(1).lower() == "x" else ""
                item = f'<li class="task"><input type="checkbox" disabled{checked}/><span>{inline(cm.group(2))}</span></li>'
            else:
                item = f"<li>{inline(content)}</li>"
            tag = "ul" if is_ul else "ol"
            if not list_stack or list_stack[-1][1] < level:
                out.append(f"<{tag}>")
                list_stack.append((tag, level))
                out.append(item)
            elif list_stack[-1][1] == level and list_stack[-1][0] == tag:
                out.append(item)
            else:
                while list_stack and list_stack[-1][1] > level:
                    t, _ = list_stack.pop()
                    out.append(f"</{t}>")
                if list_stack and list_stack[-1][1] == level and list_stack[-1][0] == tag:
                    out.append(item)
                else:
                    out.append(f"<{tag}>")
                    list_stack.append((tag, level))
                    out.append(item)
            i += 1
            continue

        if not stripped:
            close_lists(0)
            i += 1
            continue

        # paragraph
        close_lists(0)
        buf = [line]
        i += 1
        while i < n and lines[i].strip() and not (
            lines[i].strip().startswith(("#", "|", ">", "```"))
            or re.match(r"^(\s*)([-*]|\d+\.)\s+", lines[i])
            or lines[i].strip() == "---"
        ):
            buf.append(lines[i])
            i += 1
        out.append("<p>" + inline(" ".join(x.strip() for x in buf if x.strip())) + "</p>")

    close_lists(0)
    return "\n".join(out)


def build_html(title: str, body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{html.escape(title)}</title>
<style>{CSS}</style>
</head>
<body>
<div class="page">
<article>
{body}
</article>
<footer>由 Codex 生成 · 自包含 HTML（离线可看）</footer>
</div>
</body>
</html>"""


# ---------------------------------------------------------------- mermaid

PALETTE = [
    ("#eff6ff", "#3b82f6"),  # blue
    ("#f0fdf4", "#22c55e"),  # green
    ("#fffbeb", "#f59e0b"),  # amber
    ("#fdf2f8", "#ec4899"),  # pink
    ("#eef2ff", "#6366f1"),  # indigo
]


def parse_mermaid(code: str):
    """Return (nodes, edges, direction). nodes: id -> (title, sub).

    Two passes: first collect every node definition (ID[label]) even when
    definitions and edges share a line (e.g. `A[x] --> B[y]`), then collect
    edges so forward references work too.
    """
    direction = "LR"
    raw_lines = [ln.strip() for ln in code.splitlines() if ln.strip()]
    nodes: dict[str, tuple[str, str]] = {}
    for line in raw_lines:
        if line.startswith("flowchart"):
            direction = "LR" if "LR" in line else ("TD" if "TD" in line else direction)
            continue
        for m in re.finditer(r"([A-Za-z0-9_]+)\[(.*?)\]", line):
            label = m.group(2).strip().strip('"').strip("'")
            parts = [p.strip() for p in label.split("<br/>")]
            nodes[m.group(1)] = (parts[0], parts[1] if len(parts) > 1 else "")
    edges: list[tuple[str, str]] = []
    for line in raw_lines:
        if "-->" not in line:
            continue
        line = re.sub(r"\|[^|]*\|", "", line)  # drop edge labels like |yes|
        segs = re.split(r"-->", line)
        # strip bracket definitions so only node IDs remain (ignore <br/>, label words)
        id_segs = [re.findall(r"[A-Za-z0-9_]+", re.sub(r"\[.*?\]", "", s)) for s in segs]
        for k in range(len(segs) - 1):
            a = id_segs[k][-1] if id_segs[k] else None
            b = id_segs[k + 1][0] if id_segs[k + 1] else None
            if a in nodes and b in nodes:
                edges.append((a, b))
    return nodes, edges, direction


def find_back_edges(ids, adj):
    """DFS-based cycle detection; returns a set of back edges (u, v)."""
    WHITE, GRAY, BLACK = 0, 1, 2
    state = {n: WHITE for n in ids}
    back: set[tuple[str, str]] = set()

    def dfs(u: str):
        state[u] = GRAY
        for v in adj[u]:
            if state[v] == GRAY:
                back.add((u, v))
            elif state[v] == WHITE:
                dfs(v)
        state[u] = BLACK

    for n in ids:
        if state[n] == WHITE:
            dfs(n)
    return back


def compute_layers(ids, edges):
    """Longest-path layering on the DAG obtained by dropping back edges.

    Returns (layer, back_edges). Back edges are drawn as dashed loops."""
    adj = defaultdict(list)
    for s, t in edges:
        adj[s].append(t)
    back = find_back_edges(ids, adj)
    dag = [(s, t) for s, t in edges if (s, t) not in back]
    indeg = defaultdict(int)
    adj_dag = defaultdict(list)
    for s, t in dag:
        adj_dag[s].append(t)
        indeg[t] += 1
    layer = {n: 0 for n in ids}
    q = deque(n for n in ids if indeg[n] == 0)
    seen = set()
    while q:
        u = q.popleft()
        seen.add(u)
        for v in adj_dag[u]:
            layer[v] = max(layer[v], layer[u] + 1)
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    # nodes still unseen (should not happen after removing back edges) -> fallback
    nxt = max(layer.values(), default=-1) + 1
    for n in ids:
        if n not in seen:
            layer[n] = nxt
            nxt += 1
    return layer, back


def text_width(s: str, size: float) -> float:
    w = 0.0
    for ch in s:
        if unicodedata.east_asian_width(ch) in ("W", "F"):
            w += size
        elif ch == " ":
            w += size * 0.3
        else:
            w += size * 0.56
    return w


def render_mermaid(code: str) -> str:
    nodes, edges, direction = parse_mermaid(code)
    if not nodes:
        return '<pre class="code"><code>' + esc(code) + "</code></pre>"
    layer, back_edges = compute_layers(list(nodes), edges)
    max_layer = max(layer.values())
    by_layer = defaultdict(list)
    for n, l in layer.items():
        by_layer[l].append(n)

    fs_t, fs_s, bh = 14.5, 12.5, 76
    bw = {}
    for n, (t, s) in nodes.items():
        w = max(text_width(t, fs_t), text_width(s, fs_s) if s else 0) + 28
        bw[n] = max(160, min(460, w))

    gap, margin = 40, 30
    if direction == "TD":
        row_h = bh + 24
        rows = sorted(by_layer)
        y = {}
        total_h = len(rows) * (bh + gap) - gap
        cur_y = margin + max(0, (total_h - len(rows) * bh - (len(rows) - 1) * gap)) // 2
        for l in rows:
            y.update({n: cur_y for n in by_layer[l]})
            cur_y += bh + gap
        x = {}
        for l in rows:
            w_max = max((bw[n] for n in by_layer[l]), default=160)
            total_w = w_max
            start_x = margin + max(0, (0))  # computed after canvas width known
            # center each row
            for n in by_layer[l]:
                x[n] = (margin + w_max / 2) - bw[n] / 2
        canvas_w = margin * 2 + max((max(bw[n] for n in by_layer[l]) for l in rows), default=160)
        canvas_h = margin * 2 + len(rows) * (bh + gap) - gap
    else:  # LR
        col_w = {}
        for l in range(max_layer + 1):
            col_w[l] = max((bw[n] for n in by_layer[l]), default=160)
        canvas_w = margin * 2 + sum(col_w[l] for l in range(max_layer + 1)) + gap * max_layer
        max_col_nodes = max((len(by_layer[l]) for l in range(max_layer + 1)), default=1)
        canvas_h = margin * 2 + max_col_nodes * (bh + 24)
        x, y = {}, {}
        for n, l in layer.items():
            cx = margin + sum(col_w[cl] for cl in range(l)) + gap * l
            x[n] = cx + (col_w[l] - bw[n]) / 2
        for l in range(max_layer + 1):
            ns = by_layer[l]
            total = len(ns) * (bh + 24) - 24
            start_y = margin + (canvas_h - 2 * margin - total) / 2
            for k, n in enumerate(ns):
                y[n] = start_y + k * (bh + 24)

    # arrows
    arrow_parts = []
    marker = "arrLR" if direction == "LR" else "arrTD"
    for s, t in edges:
        if (s, t) in back_edges:
            continue  # back edges drawn below
        if direction == "LR":
            x1, y1 = x[s] + bw[s], y[s] + bh / 2
            x2, y2 = x[t], y[t] + bh / 2
        else:
            x1, y1 = x[s] + bw[s] / 2, y[s] + bh
            x2, y2 = x[t] + bw[t] / 2, y[t]
        arrow_parts.append(
            f'<line x1="{x1:.0f}" y1="{y1:.0f}" x2="{x2:.0f}" y2="{y2:.0f}" '
            f'stroke="#64748b" stroke-width="1.8" marker-end="url(#{marker})"/>'
        )

    # back edges (dashed loop)
    for s, t in edges:
        if (s, t) not in back_edges:
            continue
        if direction == "LR":
            # loop under the graph
            xa, ya = x[s] + bw[s] / 2, y[s] + bh
            xb = x[t] + bw[t] / 2
            yb = y[t]
            ly = canvas_h - margin
            arrow_parts.append(
                f'<path d="M {xa:.0f} {ya:.0f} V {ly:.0f} H {xb:.0f} V {yb:.0f}" '
                f'fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#{marker})"/>'
            )
        else:
            xa, ya = x[s] + bw[s] / 2, y[s] + bh
            xb, yb = x[t] + bw[t] / 2, y[t]
            lx = margin - 12
            arrow_parts.append(
                f'<path d="M {xa:.0f} {ya:.0f} H {lx:.0f} V {yb + bh / 2:.0f} H {xb:.0f}" '
                f'fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-dasharray="6 4" marker-end="url(#{marker})"/>'
            )

    box_parts = []
    for n, (t, s) in nodes.items():
        fill, stroke = PALETTE[layer[n] % len(PALETTE)]
        cx = x[n] + bw[n] / 2
        box_parts.append(
            f'<rect x="{x[n]:.0f}" y="{y[n]:.0f}" width="{bw[n]:.0f}" height="{bh}" '
            f'rx="12" fill="{fill}" stroke="{stroke}" stroke-width="1.6"/>'
        )
        if s:
            box_parts.append(
                f'<text x="{cx:.0f}" y="{y[n] + 34:.0f}" text-anchor="middle" font-size="{fs_t}" '
                f'font-weight="700" fill="#1e293b">{esc(t)}</text>'
            )
            box_parts.append(
                f'<text x="{cx:.0f}" y="{y[n] + 56:.0f}" text-anchor="middle" font-size="{fs_s}" '
                f'fill="#475569">{esc(s)}</text>'
            )
        else:
            box_parts.append(
                f'<text x="{cx:.0f}" y="{y[n] + bh / 2 + 5:.0f}" text-anchor="middle" font-size="{fs_t}" '
                f'font-weight="700" fill="#1e293b">{esc(t)}</text>'
            )

    parts = [
        f'<svg viewBox="0 0 {canvas_w:.0f} {canvas_h:.0f}" xmlns="http://www.w3.org/2000/svg" '
        'role="img" aria-label="flowchart" style="width:100%;height:auto;background:#fbfcfe;'
        'border:1px solid #e5e7eb;border-radius:12px;'
        "font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;\">",
        f'<defs><marker id="{marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
        'markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" '
        'fill="#64748b"/></marker></defs>',
        *arrow_parts,
        *box_parts,
        "</svg>",
    ]
    return "\n".join(parts)


# ------------------------------------------------------------------ main


def main(argv) -> int:
    if len(argv) < 1:
        print(__doc__)
        return 2
    src = argv[0]
    dst = argv[1] if len(argv) > 1 else re.sub(r"\.md$", ".html", src, flags=re.I)
    if dst == src:
        dst = src + ".html"
    with open(src, encoding="utf-8") as f:
        md_text = f.read()
    m = re.search(r"^#\s+(.+)$", md_text, re.M)
    title = m.group(1).strip() if m else src
    body = convert(md_text)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(build_html(title, body))
    print(f"OK: {dst}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
