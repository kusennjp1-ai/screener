import json,sys
d=json.load(open(sys.argv[1]))
ind=d['indicators']
i0=ind[0]
print(json.dumps(i0['windows']['21'],ensure_ascii=False)[:2500])
print([ (i['key'],i['judged']) for i in ind])
