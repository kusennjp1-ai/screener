// Offline GitHub Releases fake for the audit archive tests. It implements only
// the REST/download behaviour the archive tooling relies on, persists to a
// directory so separate CLI processes share one fake, and never touches the
// network. Faults are injected per asset to exercise every fail-closed path.
import {createHash} from 'node:crypto';
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const FAKE_WRITE_TOKEN='fake-archive-write-token';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=(status,value,headers={})=>new Response(value===null?null:JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});

export function releasesFake(dir,{repository='kusennjp1-ai/screener'}={}){
  mkdirSync(join(dir,'assets'),{recursive:true});
  const statePath=join(dir,'state.json'),logPath=join(dir,'calls.jsonl');
  const load=()=>existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{nextId:1000,releases:[],faults:{}};
  const save=state=>writeFileSync(statePath,JSON.stringify(state));
  const record=entry=>appendFileSync(logPath,JSON.stringify(entry)+'\n');
  const downloadUrl=(tag,name)=>`https://github.com/${repository}/releases/download/${tag}/${name}`;
  const view=(state,release)=>({...release,assets:release.assets.map(asset=>{
    const fault=state.faults[`${release.tag_name}/${asset.name}`]||{};
    return {id:asset.id,name:asset.name,size:asset.size,state:asset.state,content_type:asset.content_type,browser_download_url:downloadUrl(release.tag_name,asset.name),
      digest:fault.noDigest?null:fault.digest??asset.digest,...(fault.extraAssetFields||{})};
  })});
  const now=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');

  async function fetcher(input,options={}){
    const url=new URL(typeof input==='string'?input:input.url),method=(options.method||'GET').toUpperCase();
    const headers=new Headers(options.headers||{}),auth=headers.get('authorization');
    record({method,url:url.href,auth:Boolean(auth),redirect:options.redirect??null,range:headers.get('range'),acceptEncoding:headers.get('accept-encoding')});
    const state=load(),writer=auth===`Bearer ${FAKE_WRITE_TOKEN}`;
    const prefix=`/repos/${repository}/`;
    if(url.hostname==='api.github.com'||url.hostname==='uploads.github.com'){
      if(options.redirect!=='error')throw Error('API requests must refuse redirects');
      if(!url.pathname.startsWith(prefix))return json(404,{message:'Not Found'});
      const route=url.pathname.slice(prefix.length);
      const visible=release=>writer||!release.draft;
      if(method!=='GET'&&!writer)return json(403,{message:'Resource not accessible by integration'});
      let match;
      if(url.hostname==='uploads.github.com'){
        match=/^releases\/(\d+)\/assets$/.exec(route);
        const release=match&&state.releases.find(item=>item.id===Number(match[1]));
        if(method!=='POST'||!release)return json(404,{message:'Not Found'});
        const name=url.searchParams.get('name');
        if(release.assets.some(asset=>asset.name===name))return json(422,{message:'already_exists'});
        const bytes=Buffer.from(options.body),id=state.nextId++,file=join(dir,'assets',`${id}.bin`);
        writeFileSync(file,bytes);
        const fault=state.faults[`${release.tag_name}/${name}`]||{};
        const asset={id,name,size:fault.uploadIncomplete?bytes.length+1:bytes.length,state:fault.uploadIncomplete?'starter':'uploaded',content_type:headers.get('content-type'),digest:`sha256:${sha(bytes)}`,file};
        release.assets.push(asset);save(state);return json(201,view(state,{...release,assets:[asset]}).assets[0]);
      }
      if(method==='GET'&&route==='releases'){
        const page=Number(url.searchParams.get('page')||1),per=Number(url.searchParams.get('per_page')||30);
        const items=state.releases.filter(visible).slice().reverse().slice((page-1)*per,page*per);
        return json(200,items.map(release=>view(state,release)));
      }
      if(method==='GET'&&(match=/^releases\/tags\/(.+)$/.exec(route))){
        const tag=decodeURIComponent(match[1]),release=state.releases.find(item=>item.tag_name===tag&&!item.draft);
        return release?json(200,view(state,release)):json(404,{message:'Not Found'});
      }
      if(method==='POST'&&route==='releases'){
        const body=JSON.parse(options.body);
        if(state.releases.some(item=>item.tag_name===body.tag_name&&!item.draft))return json(422,{message:'tag already exists'});
        const release={id:state.nextId++,tag_name:body.tag_name,target_commitish:body.target_commitish,name:body.name,body:body.body,draft:Boolean(body.draft),
          prerelease:false,make_latest:body.make_latest,created_at:now(),published_at:body.draft?null:now(),assets:[]};
        state.releases.push(release);save(state);return json(201,view(state,release));
      }
      if((match=/^releases\/(\d+)$/.exec(route))){
        const release=state.releases.find(item=>item.id===Number(match[1]));
        if(!release||!visible(release))return json(404,{message:'Not Found'});
        if(method==='GET')return json(200,view(state,release));
        if(method==='PATCH'){
          const body=JSON.parse(options.body);
          if(body.draft===false&&release.draft){release.draft=false;release.published_at=now();}
          if(Object.hasOwn(body,'make_latest'))release.make_latest=body.make_latest;
          for(const key of Object.keys(body))if(!['draft','make_latest'].includes(key))release[key]=body[key];
          save(state);return json(200,view(state,release));
        }
        if(method==='DELETE'){state.releases=state.releases.filter(item=>item!==release);save(state);return new Response(null,{status:204});}
      }
      if(method==='DELETE'&&(match=/^releases\/assets\/(\d+)$/.exec(route))){
        for(const release of state.releases){const before=release.assets.length;release.assets=release.assets.filter(asset=>asset.id!==Number(match[1]));if(release.assets.length!==before){save(state);return new Response(null,{status:204});}}
        return json(404,{message:'Not Found'});
      }
      return json(404,{message:'Not Found'});
    }
    if(url.hostname==='github.com'){
      const match=new RegExp(`^/${repository}/releases/download/([^/]+)/([^/]+)$`).exec(url.pathname);
      const release=match&&state.releases.find(item=>item.tag_name===decodeURIComponent(match[1])&&!item.draft);
      const asset=release?.assets.find(item=>item.name===decodeURIComponent(match[2])&&item.state==='uploaded');
      if(!asset)return new Response('Not Found',{status:404});
      const fault=state.faults[`${release.tag_name}/${asset.name}`]||{};
      const location=fault.redirectTo??`https://release-assets.githubusercontent.com/github-production-release-asset/${asset.id}?sp=r&sig=fake`;
      return new Response(null,{status:302,headers:{location}});
    }
    if(url.hostname==='release-assets.githubusercontent.com'||url.hostname==='objects.githubusercontent.com'){
      const id=Number(/^\/github-production-release-asset\/(\d+)$/.exec(url.pathname)?.[1]);
      const pair=state.releases.flatMap(release=>release.assets.map(asset=>[release,asset])).find(([,asset])=>asset.id===id);
      if(!pair)return new Response('Not Found',{status:404});
      const [release,asset]=pair,fault=state.faults[`${release.tag_name}/${asset.name}`]||{};
      if(fault.status)return new Response('fault',{status:fault.status});
      let bytes=readFileSync(asset.file);
      if(fault.replaceBytes)bytes=Buffer.from(fault.replaceBytes,'base64');
      const extra=fault.contentEncoding?{'content-encoding':fault.contentEncoding}:{};
      const range=headers.get('range');
      if(range==='bytes=0-1'&&!fault.ignoreRange)return new Response(bytes.subarray(0,2),{status:206,headers:{'content-range':`bytes 0-1/${bytes.length}`,'content-length':'2',...extra}});
      return new Response(bytes,{status:200,headers:{'content-length':String(bytes.length),'content-type':'application/octet-stream',...extra}});
    }
    throw Error(`Unexpected fake fetch ${url.href}`);
  }
  return {
    fetch:fetcher,
    state:load,
    calls:()=>existsSync(logPath)?readFileSync(logPath,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[],
    fault(tag,name,value){const state=load();state.faults[`${tag}/${name}`]={...(state.faults[`${tag}/${name}`]||{}),...value};save(state);},
    clearFaults(){const state=load();state.faults={};save(state);},
    // Seed a release directly (pre-existing published or draft state).
    seed({tag,name,bytes,draft=false,assetState='uploaded'}){
      const state=load(),file=join(dir,'assets',`${state.nextId}.bin`),assetId=state.nextId++;writeFileSync(file,bytes);
      const release={id:state.nextId++,tag_name:tag,target_commitish:'b'.repeat(40),name:tag,body:'',draft,prerelease:false,make_latest:'false',created_at:now(),published_at:draft?null:now(),
        assets:name?[{id:assetId,name,size:bytes.length,state:assetState,content_type:'application/gzip',digest:`sha256:${sha(bytes)}`,file}]:[]};
      state.releases.push(release);save(state);return release;
    },
    removeRelease(tag){const state=load();state.releases=state.releases.filter(item=>item.tag_name!==tag);save(state);},
    // gh api responses as the read-only publisher token would see them.
    apiEntries(){
      const state=load(),published=state.releases.filter(release=>!release.draft).slice().reverse().map(release=>view(state,release)),out={};
      for(let page=1;;page++){const items=published.slice((page-1)*100,page*100);out[`repos/${repository}/releases?per_page=100&page=${page}`]=items;if(items.length<100)break;}
      return out;
    },
  };
}
