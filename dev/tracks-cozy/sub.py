"""Exact-substring replace helper: python dev/tracks-cozy/sub.py <file> <edits.json>
edits.json = [[old, new], ...]; every `old` must occur exactly once. UTF-8, LF preserved."""
import json, sys
path, edits = sys.argv[1], json.load(open(sys.argv[2], encoding='utf-8'))
s = open(path, encoding='utf-8', newline='').read()
for old, new in edits:
    n = s.count(old)
    if n != 1:
        sys.exit(f'{n} matches for: {old[:80]!r}')
    s = s.replace(old, new)
open(path, 'w', encoding='utf-8', newline='').write(s)
print('ok', len(edits))
