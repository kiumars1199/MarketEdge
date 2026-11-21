import json,sys,collections
d=json.load(open(sys.argv[1]))
print("STATE",d['state'],"pages",len(d['results']))
for r in d['results']:
    issues=[]
    if r['console']: issues.append(("console",r['console']))
    if r['pageerrors']: issues.append(("pageerrors",r['pageerrors']))
    if r['failed']: issues.append(("failed",r['failed']))
    if r['bad']: issues.append(("bad",r['bad']))
    if r['banned']: issues.append(("banned",r['banned']))
    if not r.get('footerDisclaimer'): issues.append(("NO footer disclaimer", r['disclaimer']))
    if r.get('hscroll'): issues.append(("hscroll",r['hscroll']))
    print(f"{r['width']:>5} {r['route']:<22} {r['status']} -> {r['finalUrl']}" + ("" if issues else "  ok"))
    for k,v in issues: print("      ",k, json.dumps(v)[:700])
bad=[l for l in d['links'] if not (isinstance(l['status'],int) and l['status']<400)]
print("links checked",len(d['links']),"broken",len(bad))
for l in bad: print("   BROKEN",l)
