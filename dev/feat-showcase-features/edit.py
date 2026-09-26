import sys, json
def edit(p, pairs):
    s=open(p,encoding='utf8',newline='').read()
    for a,b in pairs:
        assert s.count(a)==1, (p,a[:80], s.count(a))
        s=s.replace(a,b)
    open(p,'w',encoding='utf8',newline='').write(s)
