import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {chmodSync,closeSync,fstatSync,mkdtempSync,openSync,readFileSync,readdirSync,rmSync,symlinkSync,unlinkSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {checkedStorageLocation,downloadReviewedJobLog,readReviewedJobLog,maximumLogBytes,operationTimeoutMs} from './download-reviewed-job-log.mjs';

const job=117274547210,otherJob=117279659374;
const signed='https://productionresultssa8.blob.core.windows.net/actions-results/job/log.txt?sig=mock-signed-secret';
const env={GH_TOKEN:'ghs_mock_private_token',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kusennjp1-ai/screener',
  GITHUB_API_URL:'https://api.github.com',GITHUB_SERVER_URL:'https://github.com'};
const raw=Buffer.from([0xef,0xbb,0xbf,0x1b,0x5b,0x33,0x31,0x6d,0x78,0x0d,0x0a,0x79,0x0a,0xff,0x00]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeError=error=>error.message==='Reviewed job log download failed'
  &&!String(error.stack).includes(env.GH_TOKEN)&&!String(error.stack).includes('mock-signed-secret');

// No http server, listen(), real request, provider, or external dependency.
function transport(specs){
  const calls=[];
  const request=(url,options,callback)=>{
    const spec=specs[calls.length];
    if(!spec)throw Error('Unexpected mock request');
    const req=new EventEmitter();
    req.destroy=()=>{req.destroyed=true;};
    req.end=()=>queueMicrotask(()=>{
      if(spec.requestError){req.emit('error',Error(`${env.GH_TOKEN} ${signed}`));return;}
      if(spec.stallBeforeHeaders)return;
      const response=new PassThrough();
      response.statusCode=spec.status??200;
      response.rawHeaders=spec.rawHeaders??Object.entries(spec.headers??{}).flat();
      response.complete=false;
      calls.at(-1).response=response;
      callback(response);
      queueMicrotask(()=>{
        if(response.destroyed||spec.stallBody)return;
        if(spec.error){response.destroy(Error(`${env.GH_TOKEN} ${signed}`));return;}
        for(const chunk of spec.chunks??[raw])response.write(chunk);
        response.complete=spec.complete??true;
        response.aborted=spec.aborted??false;
        response.end();
      });
    });
    calls.push({url,options,req});
    return req;
  };
  return {request,calls};
}
const redirect={status:302,headers:{Location:signed,'Set-Cookie':'must-not-forward'}};
async function withFile(fn){
  const root=mkdtempSync(join(tmpdir(),'reviewed-test-'));
  const file=join(root,'body');
  const fd=openSync(file,'wx+',0o600);
  try{return await fn({fd,file,root});}finally{closeSync(fd);rmSync(root,{recursive:true,force:true});}
}
async function rejectsTransfer(specs,expectedCalls=2,extra={}){
  const mock=transport(specs);
  await withFile(async({fd})=>{
    await assert.rejects(downloadReviewedJobLog(job,fd,{env,request:mock.request,...extra}),safeError);
    assert.ok(fstatSync(fd).size<=maximumLogBytes);
  });
  assert.equal(mock.calls.length,expectedCalls);
  assert.ok(mock.calls.every(call=>call.req.destroyed));
  assert.ok(mock.calls.every(call=>!call.response||call.response.destroyed));
}

test('both reviewed jobs preserve exact BOM, ESC, invalid UTF8, CRLF and LF bytes in regular file',async()=>{
  for(const jobId of [job,otherJob])await withFile(async({fd,file})=>{
    const mock=transport([redirect,{headers:{'Content-Length':String(raw.length)},chunks:[raw.subarray(0,2),raw.subarray(2,8),raw.subarray(8)]}]);
    assert.equal(await downloadReviewedJobLog(jobId,fd,{env,request:mock.request}),raw.length);
    const result=readFileSync(file);
    assert.deepEqual(result,raw);
    assert.equal(digest(result),digest(raw));
    assert.notEqual(digest(result.subarray(3)),digest(raw));
    assert.notEqual(digest(Buffer.from(result.toString())),digest(raw));
    const [api,storage]=mock.calls;
    assert.equal(api.url.href,`https://api.github.com/repos/kusennjp1-ai/screener/actions/jobs/${jobId}/logs`);
    assert.equal(api.options.headers.Authorization,`Bearer ${env.GH_TOKEN}`);
    assert.equal(storage.url.href,signed);
    assert.deepEqual(storage.options.headers,{'User-Agent':'screener-reviewed-job-log','Accept-Encoding':'identity'});
    for(const call of mock.calls){
      assert.equal(call.options.method,'GET');
      assert.equal(call.options.rejectUnauthorized,true);
      assert.equal(call.options.agent,false);
      assert.equal(call.options.maxHeaderSize,16384);
      assert.equal(call.options.checkServerIdentity,undefined);
      assert.equal(call.options.ca,undefined);
      assert.equal(call.options.headers.Cookie,undefined);
      assert.equal(call.options.headers.Referer,undefined);
    }
  });
});

test('finite documented storage hosts accepted; unknown and disguised origins rejected',()=>{
  for(let i=0;i<20;i++)assert.equal(checkedStorageLocation(`https://productionresultssa${i}.blob.core.windows.net/log?sig=mock`).hostname,`productionresultssa${i}.blob.core.windows.net`);
  for(const url of [undefined,[], '/relative',signed.replace('https:','http:'),signed.replace('https:','file:'),
    signed.replace('productionresultssa8','productionresultssa20'),signed.replace('productionresultssa8','arbitrary'),
    signed.replace('.net/','.net.evil.invalid/'),signed.replace('.net/','.net:444/'),signed.replace('.net/','.net:443/'),
    signed.replace('https://','https://user:pass@'),signed.replace('https://','https://@'),signed+'#fragment',signed+'#',
    signed.replace('https://','https://\n'),signed.replace('production','%70roduction'),signed.replace('https://','HTTPS://'),
    signed.replace('.net/','.net./'),signed.replace('.net/','.net\\'),signed.replace('productionresultssa8','127.0.0.1'),
    'https://api.github.com/logs','https://results-receiver.actions.githubusercontent.com/logs'])assert.throws(()=>checkedStorageLocation(url),safeError);
});

test('unreviewed IDs and non-workflow/unsafe credential contexts fail before requests',async()=>{
  for(const jobId of [0,1,'117274547210',null,NaN,117274547211])await withFile(async({fd})=>{
    let calls=0;
    await assert.rejects(downloadReviewedJobLog(jobId,fd,{env,request:()=>{calls++;}}),safeError);
    assert.equal(calls,0);
  });
  for(const change of [{GITHUB_ACTIONS:'false'},{GITHUB_REPOSITORY:'other/repository'},{GH_TOKEN:''},{GH_TOKEN:'secret\r\nX-Evil: true'},
    {GITHUB_API_URL:'https://evil.invalid'},{GITHUB_SERVER_URL:'http://github.com'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'}])await withFile(async({fd})=>{
    let calls=0;
    await assert.rejects(downloadReviewedJobLog(job,fd,{env:{...env,...change},request:()=>{calls++;}}),safeError);
    assert.equal(calls,0);
  });
});

test('proxy, preload and custom trust overrides fail closed without bypassing network controls',async()=>{
  for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy',
    'NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','OPENSSL_CONF','NODE_USE_ENV_PROXY',
    'GLOBAL_AGENT_HTTP_PROXY','GLOBAL_AGENT_HTTPS_PROXY'])await withFile(async({fd})=>{
    let calls=0;
    await assert.rejects(downloadReviewedJobLog(job,fd,{env:{...env,[key]:'configured'},request:()=>{calls++;}}),safeError);
    assert.equal(calls,0);
    assert.throws(()=>readReviewedJobLog(job,{env:{...env,[key]:'configured'},spawn:()=>{calls++;}}),safeError);
    assert.equal(calls,0);
  });
});

test('initial bad statuses, denials and alternate redirects stop without retry or storage request',async()=>{
  for(const status of [200,301,303,307,308,401,403,404,429,500])await rejectsTransfer([{status,headers:{Location:signed}}],1);
});
test('storage bad statuses and redirects stop without retry or third request',async()=>{
  for(const status of [204,206,301,302,303,307,308,401,403,404,429,500])await rejectsTransfer([redirect,{status,headers:{Location:signed}}]);
});
test('missing, duplicate and insecure Location fail closed before storage',async()=>{
  for(const headers of [{},{Location:'http://productionresultssa8.blob.core.windows.net/log'},{Location:'https://evil.invalid/log'}])await rejectsTransfer([{status:302,headers}],1);
  await rejectsTransfer([{status:302,rawHeaders:['Location',signed,'location',signed]}],1);
});
test('streaming cap permits exactly 1MiB and rejects excess before writing it',async()=>{
  await withFile(async({fd})=>{
    const mock=transport([redirect,{chunks:[Buffer.alloc(maximumLogBytes)]}]);
    assert.equal(await downloadReviewedJobLog(job,fd,{env,request:mock.request}),maximumLogBytes);
  });
  await rejectsTransfer([redirect,{chunks:[Buffer.alloc(maximumLogBytes),Buffer.from([1])]}]);
  await rejectsTransfer([redirect,{headers:{'Content-Length':String(maximumLogBytes+1)}}]);
});
test('empty, truncated, overdeclared, underdeclared and incomplete transport are rejected',async()=>{
  for(const response of [{chunks:[]},{headers:{'Content-Length':String(raw.length+1)}},
    {headers:{'Content-Length':'1'}},{complete:false},{aborted:true},{error:true}])await rejectsTransfer([redirect,response]);
});
test('encoding, length and framing ambiguities cannot transform or hide raw bytes',async()=>{
  for(const headers of [{'Content-Encoding':'gzip'},{'Content-Encoding':'br'},{'Content-Length':'0'},{'Content-Length':'-1'},
    {'Content-Length':'NaN'},{'Content-Length':'00015'},{'Content-Length':'15','Transfer-Encoding':'chunked'},
    {'Transfer-Encoding':'gzip, chunked'}])await rejectsTransfer([redirect,{headers}]);
  await rejectsTransfer([redirect,{rawHeaders:['Content-Length','15','content-length','15']}]);
  await rejectsTransfer([redirect,{rawHeaders:['Content-Encoding','identity','content-encoding','gzip']}]);
  await withFile(async({fd,file})=>{
    const mock=transport([redirect,{headers:{'Content-Encoding':'identity','Transfer-Encoding':'chunked'}}]);
    await downloadReviewedJobLog(job,fd,{env,request:mock.request});
    assert.deepEqual(readFileSync(file),raw);
  });
});
test('request errors are fixed, secret-free and not retried',async()=>{
  await rejectsTransfer([{requestError:true}],1);
  await rejectsTransfer([redirect,{requestError:true}]);
});
test('single whole-operation timeout stops stalled headers or body without retries',async()=>{
  await rejectsTransfer([{stallBeforeHeaders:true}],1,{timeoutMs:15});
  await rejectsTransfer([redirect,{stallBeforeHeaders:true}],2,{timeoutMs:15});
  await rejectsTransfer([redirect,{stallBody:true}],2,{timeoutMs:15});
  assert.equal(operationTimeoutMs,30000);
});
test('only an empty private regular file descriptor can receive a response',async()=>{
  for(const fd of [0,1,2,-1])await assert.rejects(downloadReviewedJobLog(job,fd,{env,request:()=>assert.fail('network')}),safeError);
  await withFile(async({fd,file})=>{
    writeSync(fd,raw);
    await assert.rejects(downloadReviewedJobLog(job,fd,{env,request:()=>assert.fail('network')}),safeError);
    chmodSync(file,0o644);
    await assert.rejects(downloadReviewedJobLog(job,fd,{env,request:()=>assert.fail('network')}),safeError);
  });
});

test('sync wrapper gives child only file fd, bounded deadline and minimum environment; cleans success',()=>{
  const root=mkdtempSync(join(tmpdir(),'reviewed-wrapper-test-'));
  let calls=0;
  try{
    const result=readReviewedJobLog(job,{tempRoot:root,env:{...env,EXTRA_SECRET:'do-not-inherit'},spawn:(command,args,options)=>{
      calls++;
      assert.equal(command,process.execPath);
      assert.equal(args[1],'--file-worker');assert.equal(args[2],String(job));
      assert.ok(Number(args[3])>0&&Number(args[3])<=30000);
      assert.equal(options.timeout,Number(args[3]));assert.equal(options.killSignal,'SIGKILL');
      assert.deepEqual(options.env,env);
      assert.ok(!args.join(' ').includes(env.GH_TOKEN));assert.ok(!args.join(' ').includes(signed));
      assert.deepEqual(options.stdio.slice(0,3),['ignore','ignore','ignore']);
      const st=fstatSync(options.stdio[3]);assert.ok(st.isFile());assert.equal(st.nlink,1);assert.equal(st.mode&0o777,0o600);
      writeSync(options.stdio[3],raw);
      return {status:0,signal:null};
    }});
    assert.equal(calls,1);assert.deepEqual(result,raw);assert.deepEqual(readdirSync(root),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('temporary root symlinks including ancestor symlinks fail before worker spawn',()=>{
  const root=mkdtempSync(join(tmpdir(),'reviewed-wrapper-test-'));
  try{
    symlinkSync(root,join(root,'alias'));
    for(const tempRoot of [join(root,'alias'),join(root,'alias','alias'),'relative-root']){
      let calls=0;
      assert.throws(()=>readReviewedJobLog(job,{tempRoot,env,spawn:()=>{calls++;}}),safeError);
      assert.equal(calls,0);
    }
    assert.deepEqual(readdirSync(root),['alias']);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('sync wrapper cleans partial files on child errors, denial, timeout, empty and oversized result',()=>{
  for(const kind of ['throw','error','failure','timeout','empty','oversized']){
    const root=mkdtempSync(join(tmpdir(),'reviewed-wrapper-test-'));
    try{
      assert.throws(()=>readReviewedJobLog(job,{tempRoot:root,env,spawn:(_command,_args,options)=>{
        if(kind!=='empty')writeSync(options.stdio[3],kind==='oversized'?Buffer.alloc(maximumLogBytes+1):raw);
        if(kind==='throw')throw Error(`${env.GH_TOKEN} ${signed}`);
        if(kind==='error')return {error:Error(`${env.GH_TOKEN} ${signed}`)};
        if(kind==='failure')return {status:1};
        if(kind==='timeout')return {status:null,signal:'SIGKILL'};
        return {status:0,signal:null};
      }}),safeError);
      assert.deepEqual(readdirSync(root),[]);
    }finally{rmSync(root,{recursive:true,force:true});}
  }
});
test('path substitution cannot redirect writes or leak through a symlink; cleanup leaves target intact',()=>{
  const root=mkdtempSync(join(tmpdir(),'reviewed-wrapper-test-'));
  const target=join(root,'target');
  const targetFd=openSync(target,'wx',0o600);writeSync(targetFd,'unchanged');closeSync(targetFd);
  try{
    assert.throws(()=>readReviewedJobLog(job,{tempRoot:root,env,spawn:(_command,_args,options)=>{
      const directory=readdirSync(root).find(name=>name.startsWith('reviewed-job-log-'));
      const path=join(root,directory,'body');unlinkSync(path);symlinkSync(target,path);
      writeSync(options.stdio[3],raw);
      return {status:0,signal:null};
    }}),safeError);
    assert.deepEqual(readdirSync(root),['target']);assert.equal(readFileSync(target,'utf8'),'unchanged');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('direct worker refuses invalid context silently without stdin/stdout body transport',()=>{
  const script=fileURLToPath(new URL('./download-reviewed-job-log.mjs',import.meta.url));
  const child=spawnSync(process.execPath,[script,'--file-worker',String(job),'50'],{env:{},input:raw,timeout:1000});
  assert.equal(child.status,1);assert.equal(child.stdout.length,0);assert.equal(child.stderr.length,0);
});
