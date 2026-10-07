// Fixture authority is explicit and independent of the checkout's activation
// phase. This changes only disposable test inputs, never production policy.
import {rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {renewalPolicy,renewalPolicyPath} from '../financial-source-renewal.mjs';

export const disabledRenewalRegistry=()=>({...structuredClone(renewalPolicy),publication_enabled:false,
  ci_admission:null,reviewed_controllers:[],reviewed_consumer_transitions:[]});

export function resetRenewalFixtureControls(root){
  writeFileSync(join(root,renewalPolicyPath),JSON.stringify(disabledRenewalRegistry()));
  for(const key of ['request','pin','intent'])rmSync(join(root,renewalPolicy[`${key}_path`]),{force:true});
}
