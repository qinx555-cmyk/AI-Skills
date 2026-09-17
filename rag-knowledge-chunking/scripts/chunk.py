"""Source-preserving structural chunking. Standard library only; no model/network calls."""
import argparse
import hashlib
import json
import re
from pathlib import Path

VERSION = 'rag-knowledge-chunking-1.0.0'
ATOMIC = {'table_row', 'table', 'code', 'codeBlock', 'image', 'html'}


def markdown_blocks(text, source_id='markdown'):
    """Keep raw Markdown and line locations; headings inside code are never hierarchy."""
    lines = text.splitlines(keepends=True)
    blocks = []
    headings = []
    i = 0
    table_no = 0
    def add(start, end, kind, **extra):
        blocks.append(dict(id=f'{source_id}:b{len(blocks)+1}', order=len(blocks)+1,
                           kind=kind, text=''.join(lines[start:end]),
                           locator=f'Markdown 行 {start+1}–{end}',
                           section=[h[1] for h in headings], **extra))
    def heading(line):
        return re.match(r'^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$', line.rstrip('\r\n'))
    def fence(line):
        return re.match(r'^ {0,3}(`{3,}|~{3,})', line)
    def table_separator(line):
        return bool(re.fullmatch(r'\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*', line.strip()))
    def cells(line):
        return [v.strip() for v in re.split(r'(?<!\\)\|', line.strip().strip('|'))]
    while i < len(lines):
        start = i
        if not lines[i].strip():
            i += 1
            continue
        f = fence(lines[i])
        if f:
            marker = f[1]; i += 1
            while i < len(lines):
                close = re.match(r'^ {0,3}('+re.escape(marker[0])+r'{'+str(len(marker))+r',})\s*$', lines[i].rstrip('\r\n'))
                i += 1
                if close: break
            add(start, i, 'code')
            continue
        h = heading(lines[i])
        setext = i+1 < len(lines) and bool(re.fullmatch(r' {0,3}(=+|-+)\s*', lines[i+1].rstrip('\r\n')))
        if h or setext:
            level, title = (len(h[1]), h[2]) if h else (1 if lines[i+1].lstrip().startswith('=') else 2, lines[i].strip())
            while headings and headings[-1][0] >= level: headings.pop()
            headings.append((level, title)); i += 1 if h else 2
            add(start, i, 'heading', heading_level=level)
            continue
        if i+1 < len(lines) and '|' in lines[i] and table_separator(lines[i+1]):
            table_no += 1; header = cells(lines[i]); i += 2
            add(start, i, 'table_row', table=table_no, row=1, header=header,
                cells=[dict(column=n+1,header=v,value=v) for n,v in enumerate(header)])
            row = 2
            while i < len(lines) and '|' in lines[i] and lines[i].strip() and not heading(lines[i]):
                vals = cells(lines[i]); add(i, i+1, 'table_row', table=table_no, row=row, header=header,
                    cells=[dict(column=n+1,header=header[n] if n<len(header) else '',value=v) for n,v in enumerate(vals)])
                i += 1; row += 1
            continue
        if re.search(r'<table\b', lines[i], re.I):
            i += 1
            if not re.search(r'</table>', lines[start], re.I):
                while i < len(lines):
                    closed = bool(re.search(r'</table>', lines[i], re.I)); i += 1
                    if closed: break
            add(start, i, 'html', chunk_warnings=['HTML 表格尚未转换；核对合并单元格、列关系后再发布'])
            continue
        i += 1
        while i < len(lines) and lines[i].strip() and not heading(lines[i]) and not fence(lines[i]):
            if i+1 < len(lines) and ('|' in lines[i] and table_separator(lines[i+1]) or re.fullmatch(r' {0,3}(=+|-+)\s*', lines[i+1].rstrip('\r\n'))): break
            if re.search(r'<table\b',lines[i],re.I): break
            i += 1
        add(start, i, 'paragraph')
    return blocks


def text_spans(text, maximum, overlap):
    """Exact character offsets. Prefer sentence/newline boundaries; never discard text."""
    boundaries = [m.end() for m in re.finditer(r'[。！？!?](?:[”’"\']*)|\.(?=\s|$)|\n', text)]
    start = 0
    while start < len(text):
        limit = min(start+maximum, len(text))
        candidates = [p for p in boundaries if start < p <= limit]
        end = limit if limit == len(text) else (candidates[-1] if candidates else limit)
        forced = end < len(text) and end not in boundaries
        yield start, end, forced
        if end == len(text): break
        # Reuse complete trailing sentences only. Never overlap across source blocks.
        overlap_starts = [p for p in boundaries if max(start+1, end-overlap) <= p < end]
        start = overlap_starts[0] if overlap_starts else end


def split_blocks(blocks, config=None):
    cfg = config or {}
    maximum = int(cfg.get('max_chars',1024)); overlap = int(cfg.get('overlap_chars',50))
    if maximum < 1 or not 0 <= overlap < maximum: raise ValueError('require 0 <= overlap_chars < max_chars')
    pending = None
    for block in blocks:
        if not block.get('text','').strip(): continue
        b = dict(block)
        context = ' / '.join(b.get('section',[]))
        if b.get('header'): context += '\n表头：' + ' | '.join(str(v) for v in b['header'])
        atomic = b.get('kind') in ATOMIC
        spans = [(0,len(b['text']),False)] if atomic else text_spans(b['text'],maximum,overlap)
        for part, (start,end,forced) in enumerate(spans,1):
            warnings = list(b.get('chunk_warnings',[]))
            if atomic and end-start > maximum: warnings.append('原子块超长，保持完整；入库前核对模型输入上限')
            if forced: warnings.append('单句超过正文长度上限，已按字符切开；需核对连续片段')
            item = {**b, 'text':b['text'][start:end], 'context':context, 'part':part,
                    'full_block_text':b['text'], 'chunking_version':VERSION,
                    'source_spans':[dict(block_id=b['id'],locator=b.get('locator',''),start=start,end=end)],
                    'source_block_ids':[b['id']], 'chunk_warnings':warnings}
            # Pack short adjacent prose inside a single heading path. Structured objects stay atomic.
            merge = pending is not None and not atomic and b.get('kind') != 'heading' and pending.get('section_id') == b.get('section_id') and pending['kind'] not in ATOMIC and pending['context']==context and len(pending['text'])+2+len(item['text'])<=maximum and pending['source_block_ids'][-1]!=b['id']
            if merge:
                pending['text'] += '\n\n' + item['text']
                pending['source_spans'] += item['source_spans']; pending['source_block_ids'] += item['source_block_ids']
                pending['chunk_warnings'] += warnings; pending['kind'] = 'section_text'
                pending['full_block_text'] += '\n\n' + b['text']
            else:
                if pending is not None: yield pending
                pending = item
    if pending is not None: yield pending


def report(blocks, chunks):
    lookup = {b['id']:b for b in blocks}
    covered = {k:bytearray(len(b['text'])) for k,b in lookup.items()}
    errors = []
    if len(lookup) != len(blocks): errors.append('duplicate source block id')
    if not blocks or not chunks: errors.append('no readable chunks')
    for ch in chunks:
        for span in ch['source_spans']:
            bid = span['block_id']; start = span['start']; end = span['end']
            if bid not in lookup or not 0 <= start <= end <= len(lookup[bid]['text']):
                errors.append('invalid source span'); continue
            if lookup[bid]['text'][start:end] not in ch['text']: errors.append('source text mismatch')
            covered[bid][start:end] = b'\1'*(end-start)
    missing = [bid for bid,marks in covered.items() if lookup[bid]['text'].strip() and not all(marks)]
    return dict(version=VERSION,source_blocks=len(blocks),chunks=len(chunks),
                missing_source_blocks=missing,source_errors=errors,
                warnings=[dict(chunk=i+1,reason=w) for i,c in enumerate(chunks) for w in c['chunk_warnings']],
                integrity_pass=not missing and not errors,
                note='结构与来源检查，不代表真实检索或问答质量已验收')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('input',type=Path);p.add_argument('--out',required=True,type=Path)
    p.add_argument('--max-chars',type=int,default=1024);p.add_argument('--overlap-chars',type=int,default=50)
    args = p.parse_args()
    raw = args.input.read_text(encoding='utf-8-sig')
    blocks = json.loads(raw) if args.input.suffix=='.json' else markdown_blocks(raw,hashlib.sha256(raw.encode()).hexdigest()[:16])
    if isinstance(blocks,dict): blocks=blocks['blocks']
    chunks=list(split_blocks(blocks,dict(max_chars=args.max_chars,overlap_chars=args.overlap_chars)))
    quality=report(blocks,chunks)
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/'chunks.json').write_text(json.dumps(chunks,ensure_ascii=False,indent=2),encoding='utf-8')
    (args.out/'quality.json').write_text(json.dumps(quality,ensure_ascii=False,indent=2),encoding='utf-8')
    # Each exported chunk repeats heading context, including table headers, for text-only ingestion.
    (args.out/'chunks.md').write_text('\n\n'.join('## '+(c['context'].replace('\n',' / ') or '无标题来源')+'\n\n'+c['text'] for c in chunks),encoding='utf-8')
    print(json.dumps(quality,ensure_ascii=False))
    if not quality['integrity_pass']: raise SystemExit(1)

if __name__=='__main__': main()
