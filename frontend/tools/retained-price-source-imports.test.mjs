import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROOT,readRepairRequest} from '../../.github/scripts/retained-price-source-admission.mjs';
import {execFileSync} from 'node:child_process';
import {createRetainedPriceLiveApi} from '../../.github/scripts/retained-price-live-inventory.mjs';
import {ORIGINAL_RESPONSE_KEYS} from '../../.github/scripts/retained-price-source-driver.mjs';

// Exercise both Node-only initializers through the actual frontend Vite/jsdom
// transform. Literal new URL(asset, import.meta.url) must not become HTTP assets.
const root=join(dirname(fileURLToPath(import.meta.url)),'../../');
describe('retained-price source imports under the frontend configuration',()=>{
  it('keeps the admission root and default request on the native filesystem',()=>{
    expect(ROOT).toBe(root);
    expect(readRepairRequest().raw).toEqual(readFileSync(join(root,'.github/retained-price-oct6-source.json')));
  });
  it('resolves and executes the native inventory child through the transformed adapter',()=>{
    let called=0;
    const api=createRetainedPriceLiveApi(()=>{throw Error('Unexpected generic API');},{requiredIds:[1,2],report:()=>{},
      run:(command,args,options)=>{
        called++;
        expect(command).toBe(process.execPath);
        expect(args[1]).toBe(join(root,'.github/scripts/retained-price-repository-inventory.mjs'));
        expect(args[1]).not.toMatch(/^https?:/);
        // Execute the exact production child without a token: it must report
        // its closed protocol failure before any network request.
        return execFileSync(command,args,{...options,env:{...process.env,GH_TOKEN:'',GITHUB_TOKEN:''}});
      }});
    expect(()=>api('repos/kusennjp1-ai/screener/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100',true))
      .toThrow(/missing-actions-token/);
    expect(called).toBe(1);
  });
  it('loads the lazy driver from the same original-input fixture',()=>{
    const pins=JSON.parse(readFileSync(join(root,'.github/scripts/fixtures/retained-price-recovery-oct6-inputs.json')));
    const prefix='repos/kusennjp1-ai/screener';
    expect(ORIGINAL_RESPONSE_KEYS).toEqual([
      `GET ${prefix}/git/trees/2186101e92e1f71771936831cea0a40e410975f7?recursive=1`,
      ...['candidate','prior'].flatMap(role=>{
        const pin=pins[role];
        return [`GET ${prefix}/actions/runs/${pin.run_id}`,`GET ${prefix}/actions/runs/${pin.run_id}/attempts/1`,
          `GET ${prefix}/git/commits/${pin.head_sha}`,`GET_PAGES ${prefix}/actions/runs/${pin.run_id}/attempts/1/jobs?per_page=100`,
          `GET_PAGES ${prefix}/actions/runs/${pin.run_id}/artifacts?per_page=100`];
      }),
    ]);
  });
});
