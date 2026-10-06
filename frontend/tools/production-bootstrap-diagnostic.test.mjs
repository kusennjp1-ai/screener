import {describe,it,expect} from 'vitest';
import {productionShapedBootstrap} from './production-bootstrap-diagnostic.mjs';
describe('production metadata diagnostic authority boundary',()=>{
  const preview=()=>({schema:'static-json-transport-preview-v1',publication_authority:'none',ui_sha:'a'.repeat(40),ui_digest:'b'.repeat(64),data_manifest_sha256:'c'.repeat(64),transport:{logical_data_inventory_sha256:'d'.repeat(64),root:{bindings:{financialGeneration:'e'.repeat(64),financialLineageSha256:'f'.repeat(64)}}}});
  const previous=()=>({schema:1,approval:{type:'bootstrap'},known_price_dates:{NVDA:{date:'2026-10-02'}},verification_universe:{required_symbols:['NVDA']},financial_audit_files:{old:true},financial_release:{old:true},financial_correction:{old:true},ui_sha:'1'.repeat(40)});
  it('preserves ledger size inputs and new transport pins while removing approval',()=>{
    const p=preview(),old=previous(),before=structuredClone(old),result=productionShapedBootstrap(p,old);
    expect(old).toEqual(before);expect(result.known_price_dates).toEqual(old.known_price_dates);expect(result.verification_universe).toEqual(old.verification_universe);
    expect(result.transport).toEqual(p.transport);expect(result.ui_sha).toBe(p.ui_sha);expect(result.financial_generation).toBe('e'.repeat(64));
    expect(result).not.toHaveProperty('approval');expect(result).not.toHaveProperty('financial_audit_files');expect(result).not.toHaveProperty('financial_release');expect(result).not.toHaveProperty('financial_correction');expect(result.publication_authority).toBe('none');
  });
  it('does not invent financial lineage for a raw source',()=>{const p=preview();p.transport.root.bindings={financialGeneration:null,financialLineageSha256:null};expect(productionShapedBootstrap(p,previous())).not.toHaveProperty('financial_generation');});
  it('refuses missing real ledger inputs or an approved preview',()=>{expect(()=>productionShapedBootstrap({...preview(),publication_authority:'approved'},previous())).toThrow();expect(()=>productionShapedBootstrap(preview(),{schema:1})).toThrow();});
});
