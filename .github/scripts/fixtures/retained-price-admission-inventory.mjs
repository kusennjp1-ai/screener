// Real repository-worker result shapes for admission transport tests.
import {createHash} from 'node:crypto';
import {REPOSITORY_ID,LIMITS,route} from '../retained-price-repository-inventory.mjs';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function admissionSnapshotResult(runs){
  const total=runs.length,count=Math.max(1,Math.ceil(total/LIMITS.perPage)),pages=[],evidence=[];
  let bodyBytes=0;
  for(let n=1;n<=count;n++){
    const value={total_count:total,workflow_runs:structuredClone(runs.slice((n-1)*LIMITS.perPage,n*LIMITS.perPage))};
    const rels=[];
    if(n<count)rels.push(['next',n+1],['last',count]);
    if(n>1)rels.push(['prev',n-1],['first',1]);
    const link=rels.map(([rel,page])=>'<https://api.github.com/'+route(page)+'>; rel="'+rel+'"').join(', ');
    const raw=JSON.stringify(value),bytes=Buffer.byteLength(raw);bodyBytes+=bytes;pages.push({value,link});
    evidence.push({page_number:n,requested_route:route(n),status:200,observed_total:total,row_count:value.workflow_runs.length,
      ids_sha256:hash(JSON.stringify(value.workflow_runs.map(r=>r.id))),body_bytes:bytes,body_sha256:hash(raw),safe_headers:{'x-ratelimit-remaining':'1000','x-github-request-id':'FIXTURE:'+REPOSITORY_ID}});
  }
  return {schema_version:'retained-price-repository-snapshot-v1',status:'complete',pages,evidence,body_bytes:bodyBytes};
}
