import datetime, sys
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    i=int(line.split()[0]); note=" ".join(line.split()[1:])
    ms=(i>>22)+1288834974657
    print(i, datetime.datetime.fromtimestamp(ms/1000, datetime.timezone.utc).strftime("%Y-%m-%d %H:%MZ"), note)
