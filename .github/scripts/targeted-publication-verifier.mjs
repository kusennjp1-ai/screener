// Reuse the existing main verifier, including its published financial lineage
// and performance-certificate checks. This does not add a new approval type.
import {execFileSync} from 'node:child_process';
import {lstatSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const publicationVerifierPin=Object.freeze({
  repository:'kusennjp1-ai/screener',
  sha:'8cf7d9b231a5926696d261da51a4bab531f33cfa',
  tree:'82d9278408ebdb927a5124453d5c004ebf0306b8',
});
const execute=(args,cwd)=>execFileSync('git',args,{cwd,encoding:'utf8',maxBuffer:1024**2,timeout:120000}).trim();

export function assertPublicationVerifier(directory,executeGit=execute){
  const pin=publicationVerifierPin;
  if(executeGit(['rev-parse','HEAD'],directory)!==pin.sha
    ||executeGit(['rev-parse','HEAD^{tree}'],directory)!==pin.tree
    ||executeGit(['status','--porcelain','--untracked-files=all'],directory))throw Error('Pinned publication verifier is not exact and clean');
}

export async function preparePublicationVerifier(directory,{executeGit=execute,importer=url=>import(url)}={}){
  directory=resolve(directory);
  // Exclusive creation outside the controller is enforced by the caller; reject
  // links here as well before fetching any repository-controlled executable.
  for(let part=dirname(directory);;part=dirname(part)){
    if(lstatSync(part).isSymbolicLink())throw Error('Linked publication verifier workspace');
    if(part===dirname(part))break;
  }
  mkdirSync(directory,{recursive:false});
  executeGit(['init','--quiet'],directory);
  executeGit(['fetch','--depth=1','--no-tags',`https://github.com/${publicationVerifierPin.repository}.git`,publicationVerifierPin.sha],directory);
  if(executeGit(['rev-parse','FETCH_HEAD'],directory)!==publicationVerifierPin.sha
    ||executeGit(['rev-parse','FETCH_HEAD^{tree}'],directory)!==publicationVerifierPin.tree)throw Error('Fetched publication verifier identity differs from reviewed main');
  executeGit(['checkout','--quiet','--detach',publicationVerifierPin.sha],directory);
  assertPublicationVerifier(directory,executeGit);
  const module=await importer(pathToFileURL(join(directory,'.github/scripts/publication-state.mjs')).href);
  if(typeof module.livePublication!=='function')throw Error('Pinned publication verifier export is missing');
  return async options=>{
    assertPublicationVerifier(directory,executeGit);
    const result=await module.livePublication(options);
    assertPublicationVerifier(directory,executeGit);
    return result;
  };
}
