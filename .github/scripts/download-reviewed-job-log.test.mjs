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
import {checkedStorageLocation,downloadReviewedJobLog,readReviewedJobLog,reviewedJobLogDiagnostic,maximumLogBytes,operationTimeoutMs} from './download-reviewed-job-log.mjs';

const job=117274547210,otherJob=117279659374;
const signed='https://productionresultssa8.blob.core.windows.net/actions-results/job/log.txt?sig=mock-signed-secret';
const env={GH_TOKEN:'ghs_mock_private_token',GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kusennjp1-ai/screener',
  GITHUB_API_URL:'https://api.github.com',GITHUB_SERVER_URL:'https://github.com'};
const raw=Buffer.from([0xef,0xbb,0xbf,0x1b,0x5b,0x33,0x31,0x6d,0x78,0x0d,0x0a,0x79,0x0a,0xff,0x00]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePattern=/^Reviewed job log download failed(?: \(stage=(?:unknown|input|environment|file|api-request|api-response|redirect|storage-request|storage-response|storage-headers|body|worker|result|cleanup); cause=(?:rejected|invalid-input|environment-rejected|routing-or-trust-override|tls-override|unsafe-file|request-error|dns-error|tls-error|http-status|invalid-status|invalid-headers|unapproved-location|invalid-body|write-failed|incomplete-body|timeout|worker-failed|worker-start-failed|invalid-diagnostic|cleanup-failed); host=(?:none|github-api|reviewed-storage|rejected-redirect); status=(?:0|[1-5][0-9]{2})\))?$/;
const safeError=error=>safePattern.test(error.message)
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
      if(spec.requestError){req.emit('error',Object.assign(Error(`${env.GH_TOKEN} ${signed}`),{code:spec.code}));return;}
      if(spec.stallBeforeHeaders)return;
      const response=new PassThrough();
      response.statusCode=Object.hasOwn(spec,'status')?spec.status:200;
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

test('sync wrapper gives child only private body/diagnostic fds, bounded deadline and minimum environment; cleans success',()=>{
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
      assert.equal(options.stdio.length,5);
      const st=fstatSync(options.stdio[3]);assert.ok(st.isFile());assert.equal(st.nlink,1);assert.equal(st.mode&0o777,0o600);
      const report=fstatSync(options.stdio[4]);assert.ok(report.isFile());assert.equal(report.nlink,1);assert.equal(report.mode&0o777,0o600);
      assert.equal(report.size,0);assert.notEqual(st.ino,report.ino);
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


const messageFor=(stage,cause,host='none',status=0)=>
  `Reviewed job log download failed (stage=${stage}; cause=${cause}; host=${host}; status=${status})`;
async function assertTransferDiagnostic(specs,expected){
  const mock=transport(specs);
  await withFile(async({fd})=>{
    await assert.rejects(downloadReviewedJobLog(job,fd,{env,request:mock.request}),error=>{
      assert.ok(safeError(error));assert.equal(error.message,expected);return true;
    });
  });
  assert.equal(mock.calls.length,specs.length);
  assert.ok(mock.calls.every(call=>call.req.destroyed));
}

test('fixed diagnostics distinguish API/storage HTTP status without revealing headers or bodies',async()=>{
  for(const status of [100,200,301,401,403,404,429,500,599]){
    await assertTransferDiagnostic([{status,headers:{Location:signed,'X-Secret':env.GH_TOKEN},chunks:[Buffer.from(signed)]}],
      messageFor('api-response','http-status','github-api',status));
    if(status!==200)await assertTransferDiagnostic([redirect,{status,headers:{Location:signed,'X-Secret':env.GH_TOKEN},chunks:[Buffer.from(signed)]}],
      messageFor('storage-response','http-status','reviewed-storage',status));
  }
});

test('malicious and non-HTTP statuses are discarded rather than coerced or printed',async()=>{
  const poisonous={toString(){throw Error(signed);},valueOf(){throw Error(env.GH_TOKEN);}};
  for(const status of [undefined,null,false,true,-1,0,99,600,65535,Infinity,NaN,403.5,'403',signed,env.GH_TOKEN,poisonous]){
    await assertTransferDiagnostic([{status}],messageFor('api-response','invalid-status','github-api'));
    await assertTransferDiagnostic([redirect,{status}],messageFor('storage-response','invalid-status','reviewed-storage'));
  }
});

test('malicious redirects and headers produce only fixed rejected-location/header categories',async()=>{
  for(const location of [`https://${env.GH_TOKEN}.invalid/private?sig=leak`,signed+'#'+env.GH_TOKEN,
    'https://productionresultssa20.blob.core.windows.net/log?sig=leak','https://user:'+env.GH_TOKEN+'@evil.invalid',
    '\n'+signed,undefined,[],{toString(){throw Error(signed);}}]){
    await assertTransferDiagnostic([{status:302,rawHeaders:location===undefined?[]:['Location',location]}],
      messageFor('redirect',location!==undefined&&typeof location!=='string'?'invalid-headers':'unapproved-location',
        location!==undefined&&typeof location!=='string'?'github-api':'rejected-redirect',302));
  }
  await assertTransferDiagnostic([{status:302,rawHeaders:['Location',signed,'location',signed]}],
    messageFor('redirect','invalid-headers','github-api',302));
  await assertTransferDiagnostic([redirect,{headers:{'Content-Encoding':signed,'Content-Length':env.GH_TOKEN}}],
    messageFor('storage-headers','invalid-headers','reviewed-storage',200));
});

test('exception messages and unknown error codes cannot escape the fixed cause mapping',async()=>{
  for(const [code,cause] of [['ENOTFOUND','dns-error'],['EAI_AGAIN','dns-error'],['CERT_HAS_EXPIRED','tls-error'],
    ['ERR_TLS_CERT_ALTNAME_INVALID','tls-error'],['UNABLE_TO_VERIFY_LEAF_SIGNATURE','tls-error'],
    [env.GH_TOKEN,'request-error'],[signed,'request-error'],[{},'request-error'],[undefined,'request-error']]){
    await assertTransferDiagnostic([{requestError:true,code}],messageFor('api-request',cause,'github-api'));
    await assertTransferDiagnostic([redirect,{requestError:true,code}],messageFor('storage-request',cause,'reviewed-storage'));
  }
  await withFile(async({fd})=>{
    await assert.rejects(downloadReviewedJobLog(job,fd,{env,request(){throw Error(`${env.GH_TOKEN} ${signed}`);}}),
      error=>safeError(error)&&error.message===messageFor('api-request','request-error','github-api'));
  });
});

test('environment rejections report categories without values, keys, or credentials',()=>{
  for(const [change,cause] of [[{HTTPS_PROXY:signed},'routing-or-trust-override'],
    [{NODE_EXTRA_CA_CERTS:env.GH_TOKEN},'routing-or-trust-override'],
    [{NODE_TLS_REJECT_UNAUTHORIZED:'0'},'tls-override'],[{GH_TOKEN:signed},'environment-rejected']]){
    let calls=0;
    assert.throws(()=>readReviewedJobLog(job,{env:{...env,...change},spawn(){calls++;}}),error=>
      safeError(error)&&error.message===messageFor('environment',cause));
    assert.equal(calls,0);
  }
});

// Protocol fixtures are independent of the implementation: version=1;
// api-response=5, http-status=9, github-api=1; status occupies bytes 4..5.
const apiDeniedRecord=Buffer.from([1,5,9,1,1,147]); // HTTP 403
function wrapperRecord(bytes,{status=1,signal=null,error,alter,stdout,stderr}={}){
  const root=mkdtempSync(join(tmpdir(),'reviewed-diagnostic-test-'));
  try{
    assert.throws(()=>readReviewedJobLog(job,{tempRoot:root,env,spawn:(_command,_args,options)=>{
      assert.deepEqual(options.stdio.slice(0,3),['ignore','ignore','ignore']);
      if(bytes!==null)writeSync(options.stdio[4],bytes);
      if(status===0)writeSync(options.stdio[3],raw);
      alter?.(options,root);
      return {status,signal,error,stdout,stderr};
    }}),caught=>{
      assert.ok(safeError(caught));wrapperRecord.last=caught.message;return true;
    });
    assert.deepEqual(readdirSync(root),[]);
    return wrapperRecord.last;
  }finally{rmSync(root,{recursive:true,force:true});}
}

test('parent accepts one exact six-byte closed-schema failure and ignores stdout/stderr',()=>{
  assert.equal(wrapperRecord(apiDeniedRecord,{stdout:Buffer.from(signed),stderr:Buffer.from(env.GH_TOKEN)}),
    messageFor('api-response','http-status','github-api',403));
  for(const status of [0,100,599]){
    const record=Buffer.from(apiDeniedRecord);record.writeUInt16BE(status,4);
    assert.equal(wrapperRecord(record),messageFor('api-response','http-status','github-api',status));
  }
});

test('parent rejects malformed, oversized, unknown-enum and invalid-status diagnostic data',()=>{
  const invalid=[null,Buffer.alloc(0),apiDeniedRecord.subarray(0,5),Buffer.concat([apiDeniedRecord,Buffer.from([0])]),
    Buffer.from(signed),Buffer.from(env.GH_TOKEN),Buffer.alloc(1024*1024)];
  for(const [index,value] of [[0,0],[0,2],[1,255],[2,255],[3,255]]){
    const record=Buffer.from(apiDeniedRecord);record[index]=value;invalid.push(record);
  }
  for(const status of [1,99,600,65535]){const record=Buffer.from(apiDeniedRecord);record.writeUInt16BE(status,4);invalid.push(record);}
  for(const record of invalid)assert.equal(wrapperRecord(record),messageFor('worker','invalid-diagnostic'));
});

test('success status cannot carry diagnostic bytes and abnormal exits cannot supply trusted diagnostics',()=>{
  assert.equal(wrapperRecord(apiDeniedRecord,{status:0}),messageFor('worker','invalid-diagnostic'));
  for(const exit of [2,-1,null,NaN,signed,env.GH_TOKEN])
    assert.equal(wrapperRecord(apiDeniedRecord,{status:exit}),messageFor('worker','worker-failed'));
  assert.equal(wrapperRecord(apiDeniedRecord,{signal:signed}),messageFor('worker','worker-failed'));
  assert.equal(wrapperRecord(apiDeniedRecord,{error:Error(`${signed} ${env.GH_TOKEN}`)}),messageFor('worker','worker-start-failed'));
});

test('unsafe diagnostic modes, replaced paths and first-failure cleanup remain fail closed',()=>{
  assert.equal(wrapperRecord(apiDeniedRecord,{alter:(_options,root)=>{
    const directory=readdirSync(root)[0];chmodSync(join(root,directory,'diagnostic'),0o644);
  }}),messageFor('worker','invalid-diagnostic'));
  assert.equal(wrapperRecord(apiDeniedRecord,{alter:(_options,root)=>{
    const directory=readdirSync(root)[0],path=join(root,directory,'diagnostic');
    unlinkSync(path);symlinkSync('body',path);
  }}),messageFor('worker','invalid-diagnostic'));
  // Closing the body descriptor makes wrapper cleanup fail, after a valid
  // worker diagnosis has already been recovered. The first cause must survive.
  assert.equal(wrapperRecord(apiDeniedRecord,{alter:options=>closeSync(options.stdio[3])}),
    messageFor('api-response','http-status','github-api',403));
});

test('real worker writes only a fixed diagnostic to fd4 for offline preflight failures',async()=>{
  const script=fileURLToPath(new URL('./download-reviewed-job-log.mjs',import.meta.url));
  for(const [childEnv,args,expected] of [[{},[String(job),'50'],[1,2,2,0,0,0]],
    [env,['1','50'],[1,1,1,0,0,0]],[env,[String(job),'0'],[1,1,1,0,0,0]],
    [{...env,HTTPS_PROXY:signed},[String(job),'50'],[1,2,3,0,0,0]]]){
    await withFile(async({fd,root})=>{
      const reportPath=join(root,'report'),report=openSync(reportPath,'wx+',0o600);
      try{
        const child=spawnSync(process.execPath,[script,'--file-worker',...args],{
          env:childEnv,stdio:['ignore','pipe','pipe',fd,report],timeout:2000,
        });
        assert.equal(child.status,1);assert.equal(child.stdout.length,0);assert.equal(child.stderr.length,0);
        assert.deepEqual(readFileSync(reportPath),Buffer.from(expected));assert.equal(fstatSync(fd).size,0);
      }finally{closeSync(report);}
    });
  }
});

test('real child offline transport preserves exact fd3 bytes and inherited minimal environment',async()=>{
  const moduleUrl=new URL('./download-reviewed-job-log.mjs',import.meta.url).href;
  const fixture=`
    import assert from 'node:assert/strict';
    import {EventEmitter} from 'node:events';
    import {PassThrough} from 'node:stream';
    import {downloadReviewedJobLog} from ${JSON.stringify(moduleUrl)};
    const expectedEnv=${JSON.stringify(env)};
    for(const [key,value] of Object.entries(expectedEnv))assert.equal(process.env[key],value);
    assert.equal(process.env.EXTRA_SECRET,undefined);
    const bytes=Buffer.from(${JSON.stringify([...raw])});
    let calls=0;
    const request=(url,options,callback)=>{
      const call=++calls;
      assert.ok(call<=2);assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);
      if(call===1)assert.equal(options.headers.Authorization,'Bearer '+expectedEnv.GH_TOKEN);
      else assert.equal(options.headers.Authorization,undefined);
      const req=new EventEmitter();req.destroy=()=>{};
      req.end=()=>queueMicrotask(()=>{
        const response=new PassThrough();response.statusCode=call===1?302:200;
        response.rawHeaders=call===1?['Location',${JSON.stringify(signed)}]:['Content-Length',String(bytes.length)];
        callback(response);
        queueMicrotask(()=>{if(!response.destroyed){response.complete=true;response.end(bytes);}});
      });return req;
    };
    assert.equal(await downloadReviewedJobLog(${job},3,{request}),bytes.length);
    assert.equal(calls,2);
  `;
  const root=mkdtempSync(join(tmpdir(),'reviewed-real-child-test-'));
  try{
    let calls=0;
    const result=readReviewedJobLog(job,{tempRoot:root,env:{...env,EXTRA_SECRET:'do-not-inherit'},spawn:(command,_args,options)=>{
      calls++;
      // A test-only ordinary child imports the existing dependency-injected
      // transport. There is no production switch, preload or live HTTPS call.
      const child=spawnSync(command,['--input-type=module','-e',fixture],options);
      assert.equal(child.status,0);return child;
    }});
    assert.equal(calls,1);assert.deepEqual(result,raw);assert.equal(digest(result),digest(raw));
    assert.deepEqual(readdirSync(root),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});


test('structured diagnostic extraction accepts only module-created records and returns immutable copies',()=>{
  for(const error of [null,undefined,signed,Error(signed),
    {message:messageFor('api-response','http-status','github-api',403),diagnostic:{stage:'api-response',cause:'http-status',host:'github-api',status:403}},
    {get message(){throw Error(env.GH_TOKEN);},get diagnostic(){throw Error(signed);}}])
    assert.equal(reviewedJobLogDiagnostic(error),null);
  assert.throws(()=>readReviewedJobLog(job,{env:{...env,HTTPS_PROXY:signed}}),error=>{
    const first=reviewedJobLogDiagnostic(error),second=reviewedJobLogDiagnostic(error);
    assert.deepEqual(first,{stage:'environment',cause:'routing-or-trust-override',host:'none',status:0});
    assert.ok(Object.isFrozen(first));assert.notEqual(first,second);
    assert.throws(()=>{first.cause=signed;},TypeError);
    assert.deepEqual(reviewedJobLogDiagnostic(error),second);return true;
  });
});
