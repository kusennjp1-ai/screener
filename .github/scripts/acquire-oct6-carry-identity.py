#!/usr/bin/env python3
"""Read-only, hash-pinned A8 carry identity diagnostic inputs."""
import hashlib,json,os,pathlib,shutil,stat,subprocess,sys,tarfile,zipfile,time,signal,selectors,tempfile
REPO='kusennjp1-ai/screener'
HEAD='c822e55df34c1cb7b559bfa9f11ecda7018ee3ce'
RESERVE=8*1024**3
CAP=2*1024**3
ROOT=pathlib.Path(os.environ['RUNNER_TEMP'])/'carry-identity-diagnostic'
REPORT=ROOT/'reports'
REPORT.mkdir(parents=True,exist_ok=False)
PINS={
 'source':{'run':37724112702,'head':HEAD,'artifact':11527895226,'bytes':318529675,'sha256':'d1091c0165eafc29c1d6d0a27d0b35ee1b76f571fb0254bfff081fc182b49f4d','name':'static-site-data-37724112702-1'},
 'prior':{'run':37456692717,'head':'8a490df5b0a873637781a8e4e5351cece9313f37','artifact':11421722413,'bytes':363691194,'sha256':'1ab2594be91d3bbc8716481c730a9afdf22eb4ca554fcd5d02770b92252de4eb','name':'github-pages-37456692717-1'},
 'companion':{'run':37724112702,'head':HEAD,'artifact':11527157813,'bytes':7302943,'sha256':'dcafcc0d1ad089354bc551d33bfe6c32ff5620151b4f337baaa9f1298d52f248','name':'static-site-data-manifest-37724112702-1'},
}
def require(value,message):
 if not value:raise RuntimeError(message)
def sha(path):
 h=hashlib.sha256()
 with open(path,'rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
def reserve(extra=0):
 require(shutil.disk_usage(ROOT).free>=RESERVE+extra,'Eight GiB reserve would be exceeded')
def save(name,value):
 (REPORT/name).write_text(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
def api(route,name):
 result=subprocess.run(['gh','api',route],capture_output=True,timeout=60)
 require(result.returncode==0,'GitHub metadata read failed')
 require(len(result.stdout)<=16*1024**2,'Metadata response too large')
 value=json.loads(result.stdout);(REPORT/name).write_bytes(result.stdout);return value
def clean(name):
 while name.startswith('./'):name=name[2:]
 name=name.rstrip('/')
 require(name and not name.startswith('/') and '\\' not in name and all(x not in ('','.','..') for x in name.split('/')) and not any(ord(x)<32 or ord(x)==127 for x in name),'Unsafe archive path')
 return name
def download(role,pin):
 artifact=api(f'repos/{REPO}/actions/artifacts/{pin["artifact"]}',role+'-artifact.json')
 require(artifact['id']==pin['artifact'] and artifact['name']==pin['name'] and artifact['size_in_bytes']==pin['bytes'] and artifact['digest']=='sha256:'+pin['sha256'] and artifact['expired'] is False,'Artifact pin mismatch')
 require(artifact['workflow_run']['id']==pin['run'] and artifact['workflow_run']['head_sha']==pin['head'] and artifact['workflow_run']['repository_id']==1203919607,'Artifact origin mismatch')
 for suffix in ('','/attempts/1'):
  run=api(f'repos/{REPO}/actions/runs/{pin["run"]}'+suffix,role+('-current.json' if not suffix else '-attempt.json'))
  require(run['id']==pin['run'] and run['head_sha']==pin['head'] and run['run_attempt']==1 and run['head_branch']=='main' and run['status']=='completed' and run['conclusion']=='success' and run['repository']['id']==1203919607 and run['path']==('.github/workflows/research-ui-release.yml' if role=='prior' else '.github/workflows/static-site.yml'),'Original run binding mismatch')
 reserve(pin['bytes']+CAP)
 path=ROOT/(role+'.zip')
 with path.open('xb') as out,tempfile.TemporaryFile() as errors:
  child=subprocess.Popen(['gh','api',f'repos/{REPO}/actions/artifacts/{pin["artifact"]}/zip'],stdout=subprocess.PIPE,stderr=errors)
  selector=selectors.DefaultSelector();selector.register(child.stdout,selectors.EVENT_READ)
  deadline=time.monotonic()+240;count=0
  try:
   while True:
    remaining=deadline-time.monotonic();require(remaining>0,'Archive download deadline')
    events=selector.select(min(remaining,2))
    if not events:continue
    block=os.read(child.stdout.fileno(),1024*1024)
    if not block:break
    count+=len(block);require(count<=pin['bytes'],'Archive download exceeded exact byte cap');out.write(block)
   require(child.wait(timeout=max(.1,deadline-time.monotonic()))==0,'Archive download failed')
  finally:
   selector.close();child.stdout.close()
   if child.poll() is None:
    child.kill();child.wait(timeout=2)
 require(path.stat().st_size==pin['bytes'] and sha(path)==pin['sha256'],'Archive bytes/hash mismatch')
 return path
def zip_files(path):
 z=zipfile.ZipFile(path);entries=z.infolist();seen=set();total=0
 require(len(entries)<=10000,'ZIP inventory too large')
 for item in entries:
  name=clean(item.filename);require(name not in seen,'Duplicate ZIP path');seen.add(name)
  mode=item.external_attr>>16
  require(not item.flag_bits&1 and not stat.S_ISLNK(mode),'Encrypted or linked ZIP entry')
  total+=item.file_size
 require(total<=CAP,'ZIP decoded cap exceeded')
 return z,entries
def extract(role,path,destination):
 z,entries=zip_files(path)
 require(len(entries)==1 and entries[0].filename=='artifact.tar','Expected exact Pages artifact.tar wrapper')
 item=entries[0];reserve(item.file_size)
 archive=ROOT/(role+'.tar')
 with z.open(item) as source,archive.open('xb') as out:shutil.copyfileobj(source,out,1024*1024)
 z.close();require(archive.stat().st_size==item.file_size,'TAR wrapper size mismatch')
 inventory={}; selected={}; total=0
 with tarfile.open(archive,'r:') as t:
  for m in t:
   if m.name in ('.','./'):continue
   name=clean(m.name);require(name not in inventory,'Duplicate TAR path');require(m.isfile() or m.isdir(),'Linked or special TAR entry')
   inventory[name]={'kind':'file' if m.isfile() else 'directory','bytes':m.size}
   require(len(inventory)<=60000,'TAR inventory too large')
   if not m.isfile():continue
   total+=m.size;require(total<=CAP,'TAR logical cap exceeded')
   keep=(role=='source' and (name.startswith('static-data/') or name in {'research-daily.json','portfolio-model.json','qualification-audit.json','ibd-reference.json'})) or (role=='prior' and (name=='publication.json' or name=='static-data/manifest.json' or name.startswith('static-data/financial-corrections/') or name.startswith('static-data/_financial-audit-transport/')))
   if keep:selected[name]=m.size
 require('static-data/manifest.json' in selected,'Missing manifest')
 reserve(sum(selected.values())+len(selected)*4096)
 destination.mkdir(parents=True,exist_ok=True)
 hashes={}
 with tarfile.open(archive,'r:') as t:
  for m in t:
   if m.name in ('.','./'):continue
   name=clean(m.name)
   if name not in selected:continue
   out=destination/name;out.parent.mkdir(parents=True,exist_ok=True)
   with t.extractfile(m) as src,out.open('xb') as dst:shutil.copyfileobj(src,dst,1024*1024)
   require(out.stat().st_size==selected[name],'Extracted file size mismatch')
   hashes[name]={'bytes':out.stat().st_size,'sha256':sha(out)}
 save(role+'-extraction.json',{'archive_sha256':sha(archive),'archive_bytes':archive.stat().st_size,'closed_inventory':inventory,'selected':hashes,'selected_bytes':sum(selected.values()),'free_bytes':shutil.disk_usage(ROOT).free,'reserve_bytes':RESERVE})
 archive.unlink();path.unlink();reserve()
 return hashes
try:
 require(os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GITHUB_REF')=='refs/heads/preview/oct6-carry-projection-20261008' and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','Unexpected diagnostic caller')
 parents=subprocess.check_output(['git','rev-list','--parents','-n','1','HEAD'],text=True).strip().split()
 require(parents==[os.environ['GITHUB_SHA'],HEAD],'Diagnostic parent mismatch')
 caller=api(f'repos/{REPO}/actions/runs/{os.environ["GITHUB_RUN_ID"]}','caller.json')
 require(caller['head_sha']==os.environ['GITHUB_SHA'] and caller['run_attempt']==1 and caller['event']=='push' and caller['path']=='.github/workflows/oct6-carry-identity.yml','Caller origin mismatch')
 save('pins.json',PINS)
 public=pathlib.Path('release/frontend/public').resolve()
 require(public.name=='public' and public.parent.name=='frontend' and public.parent.parent.name=='release','Unexpected diagnostic destination')
 if public.exists():shutil.rmtree(public)
 public.mkdir()
 for role in ('prior','source'):
  extract(role,download(role,PINS[role]),ROOT/'prior' if role=='prior' else ROOT/'clean-source')
 companion=download('companion',PINS['companion']);z,entries=zip_files(companion)
 names={clean(x.filename):x for x in entries};require('source.json' in names and names['source.json'].file_size<=64*1024**2,'Missing bounded companion')
 source=json.loads(z.read(names['source.json']));z.close()
 (REPORT/'source.json').write_text(json.dumps(source,separators=(',',':')))
 require(source['run_id']==37724112702 and source['run_attempt']==1 and source['source_sha']==HEAD and source['artifact_name']==PINS['source']['name'],'Companion origin mismatch')
 manifest=ROOT/'clean-source/static-data/manifest.json'
 require(sha(manifest)==source['manifest_sha256'] and hashlib.sha256(source['manifest_json'].encode()).hexdigest()==source['manifest_sha256'],'Source manifest mismatch')
 require(sha(ROOT/'prior/publication.json')=='0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a','Prior receipt mismatch')
 require(sha(ROOT/'prior/static-data/manifest.json')=='ab65c8bb05f33cadd1eec71c858ed67a6ba7578ed9772c7d9ccbf24873161dd0','Prior manifest mismatch')
 save('acquisition-result.json',{'status':'passed','finished_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'free_bytes':shutil.disk_usage(ROOT).free,'reserve_bytes':RESERVE})
except BaseException as error:
 save('acquisition-result.json',{'status':'failed','error_type':type(error).__name__,'message':str(error)[:500]})
 raise
