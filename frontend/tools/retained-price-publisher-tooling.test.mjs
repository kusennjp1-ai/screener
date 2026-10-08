import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUBLISHER_TOOLING,PUBLISHER_EXPORT_ARTIFACT,publisherToolingBoundary,validatePublisherToolingIdentity,validatePublisherToolingFiles} from '../../.github/scripts/retained-price-publisher-tooling.mjs';

describe('publisher tooling under normal Vite transformation',()=>{
  it('invokes the default route without introducing an amendment',async()=>{
    const state={source:{artifact:{id:1}},carry:{},decision:{mode:'data'}},before=structuredClone(state);
    expect(await publisherToolingBoundary(state,'apply')).toBeNull();expect(state).toEqual(before);
  });
  it('reads and validates the actual separately pinned exporter fixture',()=>{
    const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),raw=readFileSync(resolve(root,PUBLISHER_EXPORT_ARTIFACT)),pin=PUBLISHER_TOOLING.files[0].after;
    expect(raw.length).toBe(pin.bytes);expect(createHash('sha256').update(raw).digest('hex')).toBe(pin.sha256);
    expect(validatePublisherToolingIdentity(structuredClone(PUBLISHER_TOOLING))).toEqual(PUBLISHER_TOOLING);
    const source={[PUBLISHER_TOOLING.files[0].path]:{mode:'100644',sha:PUBLISHER_TOOLING.files[0].before.git_blob_sha}};
    const amended={[PUBLISHER_TOOLING.files[0].path]:{mode:'100644',sha:pin.git_blob_sha}};
    expect(validatePublisherToolingFiles(source,amended,{amended:true})).toBe(true);
    expect(()=>validatePublisherToolingFiles(source,{...amended,'frontend/tools/extra.mjs':{mode:'100644',sha:pin.git_blob_sha}},{amended:true})).toThrow();
  });
});
