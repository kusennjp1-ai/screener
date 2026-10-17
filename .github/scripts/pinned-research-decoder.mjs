// Reuse the producer's existing decoder only from the exact reviewed checkout.
// This grants decoding compatibility, not source or publication authority.
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertPublicationVerifier,publicationVerifierPin} from './targeted-publication-verifier.mjs';

// Retrieved at the immutable producer commit through GitHub's read-only API.
// These are the complete import graph, plus its exact ESM package scope.
export const pinnedResearchDecoderFiles=Object.freeze({
  'frontend/src/static/researchTransport.js':'c46efac6643fcc453747024cd0cd989df1dde16d8d05c3a82ad8543f8958d74d',
  'frontend/src/static/researchFloat64.js':'659836c8832f9550d1438e7389b3956268a47b12565a68a68b71de5eee42c160',
  'frontend/src/static/researchHex.js':'70946e7c044f44efb62c361737515749cef2f4439d1f27e3963ab866f2c889c0',
  'frontend/src/static/financialHistory.js':'668e0fdcbfcfb9b2cd46ac86fca9a75a724e5ba4a5183eec245b2e0c3c1a2db5',
  'frontend/src/static/evidenceTime.js':'8f9145808be8a1e57c16cdad03dd88263a249de096d279b8afbfcac973974ca1',
  'frontend/contracts/native_annual_history_v1.json':'156c5b3715e761ece85dd529021d6205885ae84f28f3f704c7f602bdd85017fc',
  'frontend/package.json':'768e0d7dadb0d2ba0a84b8560c047fbe80a20a38b06149b6dc52aa8fa311c44f',
});
const supportedPin={sha:'8cf7d9b231a5926696d261da51a4bab531f33cfa',tree:'82d9278408ebdb927a5124453d5c004ebf0306b8'};
const capabilities=new WeakMap();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function assertDecoderFiles(directory){
  if(publicationVerifierPin.sha!==supportedPin.sha||publicationVerifierPin.tree!==supportedPin.tree)throw Error('Research decoder producer pin changed');
  // Check paths before invoking Git or importing repository-controlled code.
  for(const [relative,digest] of Object.entries(pinnedResearchDecoderFiles)){
    const path=join(directory,relative);
    for(let part=path;;part=dirname(part)){
      if(lstatSync(part).isSymbolicLink())throw Error('Linked pinned research decoder input');
      if(part===dirname(part))break;
    }
    const info=lstatSync(path);
    if(!info.isFile()||info.nlink!==1||info.size<=0||info.size>128*1024||hash(readFileSync(path))!==digest)throw Error(`Pinned research decoder bytes differ: ${relative}`);
  }
  assertPublicationVerifier(directory);
}

export async function loadPinnedResearchDecoder(directory){
  directory=resolve(directory);
  assertDecoderFiles(directory);
  const module=await import(pathToFileURL(join(directory,'frontend/src/static/researchTransport.js')).href);
  assertDecoderFiles(directory);
  if(module.RESEARCH_TRANSPORT_VERSION!=='research-table-v2'||typeof module.decodeResearchIndex!=='function')throw Error('Pinned research decoder exports differ');
  const capability=Object.freeze({});
  capabilities.set(capability,{directory,decode:module.decodeResearchIndex});
  return capability;
}

export function decodePinnedResearchIndex(capability,value){
  const approved=capabilities.get(capability);
  if(!approved)throw Error('A verified pinned research decoder is required');
  assertDecoderFiles(approved.directory);
  try{return approved.decode(value);}
  finally{assertDecoderFiles(approved.directory);}
}
