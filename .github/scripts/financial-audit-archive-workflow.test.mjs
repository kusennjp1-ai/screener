// Mutation-style workflow text contracts for the public financial audit archive.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL(`../workflows/${name}`,import.meta.url),'utf8');
function job(text,name){const start=text.indexOf(`  ${name}:\n`);assert(start>=0,`Missing job ${name}`);const end=text.slice(start+1).search(/^  [a-zA-Z][\w-]*:\s*$/m);return end<0?text.slice(start):text.slice(start,start+1+end);}
function steps(text){return text.split(/\n(?=      - )/).slice(1).map(block=>block.split(/\n(?=    [a-zA-Z])/)[0]);}
function step(text,name){const found=steps(text).filter(block=>block.startsWith(`      - name: ${name}\n`));assert.equal(found.length,1,`Missing or repeated step ${name}`);return found[0];}
function jobs(text){const body=text.slice(text.indexOf('\njobs:\n')+7);return [...body.matchAll(/^  ([a-zA-Z][\w-]*):\s*$/gm)].map(match=>match[1]);}
const archiveName='financial-audit-archive.yml',publisherName='research-ui-release.yml';
const tokenLine='          GH_TOKEN: ${{ github.token }}\n';

export function checkArchiveWorkflow(text){
  assert.match(text,/^permissions:\n  contents: read\n(?!  )/m,'top-level permissions must be exactly contents: read');
  assert.match(text,/^concurrency:\n  group: financial-audit-archive\n  cancel-in-progress: false\n/m);
  assert.deepEqual(jobs(text),['collect','upload']);
  const collect=job(text,'collect'),upload=job(text,'upload');
  assert.match(collect,/^    permissions:\n      contents: read\n(?!      )/m,'collect must be read-only');
  assert.match(upload,/^    permissions:\n      contents: write\n(?!      )/m,'upload must hold exactly contents: write');
  assert.equal((text.match(/contents: write/g)||[]).length,1,'only the upload job may write');
  assert.doesNotMatch(text,/(?:actions|pages|id-token|packages|deployments|issues|pull-requests|statuses|checks|attestations):\s*write|permissions:\s*write-all|write-all/);
  assert.match(collect,/^    if: github\.repository == 'kusennjp1-ai\/screener' && github\.ref == 'refs\/heads\/main'$/m);
  assert.match(upload,/^    needs: collect$/m);
  assert.match(upload,/^    if: \$\{\{ !cancelled\(\) && needs\.collect\.outputs\.pending == 'true' \}\}$/m);
  // Triggers: post-release, bootstrap after merge, schedule fallback and a weekly sweep.
  assert.match(text,/^  workflow_run:\n    workflows: \[Research UI Release\]\n    types: \[completed\]\n    branches: \[main\]\n/m);
  assert.match(text,/^  push:\n    branches: \[main\]\n    paths:\n      - \.github\/workflows\/financial-audit-archive\.yml\n      - \.github\/scripts\/financial-audit-archive\.mjs\n/m);
  assert.match(text,/- cron: '41 \*\/3 \* \* \*'/);assert.match(text,/- cron: '23 4 \* \* 0'/);
  assert.doesNotMatch(text,/pull_request|issue_comment|repository_dispatch/);
  // Credentials: every checkout drops its token; GH_TOKEN only where needed.
  const checkouts=text.match(/uses: actions\/checkout@v4\n        with:\n(?:          [^\n]*\n)*/g)||[];
  assert.equal(checkouts.length,(text.match(/actions\/checkout@/g)||[]).length);
  for(const block of checkouts)assert.match(block,/persist-credentials: false/,'checkout must not persist credentials');
  assert.equal(checkouts.length,2);
  const tokenSteps=[...steps(collect),...steps(upload)].filter(block=>block.includes('GH_TOKEN'));
  assert.deepEqual(tokenSteps.map(block=>/- name: (.+)\n/.exec(block)?.[1]),['Sweep the complete public archive','Create missing immutable audit archive releases']);
  for(const block of tokenSteps){assert.ok(block.includes(`        env:\n${tokenLine}`),'step-scoped token');assert.doesNotMatch(block,/GH_TOKEN:.*(?:secrets\.|steps\.|inputs\.|vars\.)/);}
  assert.doesNotMatch(text,/secrets\.|GITHUB_TOKEN:|^    env:/m,'no job-level env or secret token source');
  assert.equal(step(upload,'Create missing immutable audit archive releases').trim().split('\n').at(-1).trim(),'run: node .github/scripts/financial-audit-archive.mjs upload --input "$RUNNER_TEMP/audit-archive"');
  assert.ok(step(collect,'Stage exact hosted carry bins from live Pages').includes('run: node .github/scripts/financial-audit-archive.mjs collect --output "$RUNNER_TEMP/audit-archive"'));
  assert.ok(step(collect,'Sweep the complete public archive').includes('run: node .github/scripts/financial-audit-archive.mjs verify-history --full --orphans'));
  const order=steps(upload).map(block=>/- name: (.+)\n/.exec(block)?.[1]??/uses: (\S+)/.exec(block)?.[1]);
  assert.deepEqual(order,['actions/checkout@v4','actions/setup-node@v4','actions/download-artifact@v4','Re-verify staged bins offline','Create missing immutable audit archive releases','Verify every staged archive copy by anonymous download']);
  // Collect stages every verifiable bin first, hands them to upload, and only
  // then fails on a conflicting published copy (which is never modified).
  const collectOrder=steps(collect).map(block=>/- name: (.+)\n/.exec(block)?.[1]??/uses: (\S+)/.exec(block)?.[1]);
  assert.deepEqual(collectOrder,['actions/checkout@v4','actions/setup-node@v4','Stage exact hosted carry bins from live Pages','actions/upload-artifact@v4','Sweep the complete public archive','Fail on conflicting published archive copies']);
  const handoff=steps(collect).find(block=>block.includes('uses: actions/upload-artifact@v4'));
  assert.match(handoff,/^        if: steps\.collect\.outputs\.pending == 'true'$/m);
  assert.match(handoff,/^          if-no-files-found: error$/m);
  assert.match(step(collect,'Sweep the complete public archive'),/^        if: github\.event\.schedule == '23 4 \* \* 0' \|\| inputs\.full_sweep$/m);
  const conflict=step(collect,'Fail on conflicting published archive copies');
  assert.match(conflict,/^        if: steps\.collect\.outputs\.conflicts != '0'$/m);assert.match(conflict,/exit 1/);
  // Never the approved UI tree, npm, Pages, or a destructive release command.
  assert.doesNotMatch(text,/\bnpm\b|\bnpx\b|release\/|working-directory|deploy-pages|upload-pages-artifact|configure-pages|--clobber|gh release (?:delete|upload|edit|create)|delete-asset|continue-on-error/);
  // The module makes its own bounded REST calls; no raw REST client here.
  assert.doesNotMatch(text,/\bgh\s+api\b|\bcurl\b|\bwget\b/,'no gh api, curl or wget in the archive workflow');
  return true;
}

export function checkPublisherStep(text){
  assert.deepEqual(jobs(text),['renewal_route','publish'],'the publisher keeps exactly two jobs');
  const publish=job(text,'publish');
  assert.doesNotMatch(publish,/^    permissions:/m,'publish keeps the workflow permissions');
  assert.match(text,/^permissions:\n  contents: read\n  actions: read\n  pages: write\n  id-token: write\n(?!  )/m,'publisher workflow permissions are exactly these four');
  const name='Verify the public audit archive before omitting older carries',body=step(publish,name);
  const names=steps(publish).map(block=>/- name: (.+)\n/.exec(block)?.[1]??null);
  const at=names.indexOf(name);
  assert.equal(names[at-1],'Prepare immutable controller for finite price publication');
  assert.equal(names[at+1],'Checkout the exact verified UI source');
  assert.equal(body,`      - name: ${name}
        id: audit-archive
        if: steps.plan.outputs.publish == 'true' && steps.plan.outputs.carry == 'true' && steps.plan.outputs.limited_research_preview != 'true' && needs.renewal_route.outputs.price_source != 'true'
        timeout-minutes: 20
        env:
${tokenLine}        run: node .github/scripts/select-release-source.mjs audit-archive`);
  assert.doesNotMatch(body,/continue-on-error|working-directory|release\//);
  assert.equal((text.match(/select-release-source\.mjs audit-archive/g)||[]).length,1);
  return true;
}

test('the archive workflow keeps write access in one upload job with a step token',()=>{
  const text=read(archiveName);assert.ok(checkArchiveWorkflow(text));
  for(const [label,changed]of [
    ['top-level write',text.replace(/^permissions:\n  contents: read\n/m,'permissions:\n  contents: write\n')],
    ['collect write',text.replace('    permissions:\n      contents: read\n    outputs:','    permissions:\n      contents: write\n    outputs:')],
    ['upload actions write',text.replace('      contents: write\n','      contents: write\n      actions: write\n')],
    ['job token',text.replace('    timeout-minutes: 60\n','    timeout-minutes: 60\n    env:\n      GH_TOKEN: ${{ github.token }}\n')],
    ['token on verify-public',text.replace('      - name: Verify every staged archive copy by anonymous download\n','      - name: Verify every staged archive copy by anonymous download\n        env:\n          GH_TOKEN: ${{ github.token }}\n')],
    ['secret token',text.replace('GH_TOKEN: ${{ github.token }}\n        run: node .github/scripts/financial-audit-archive.mjs upload','GH_TOKEN: ${{ secrets.ADMIN_TOKEN }}\n        run: node .github/scripts/financial-audit-archive.mjs upload')],
    ['persisted credentials',text.replace('persist-credentials: false','persist-credentials: true')],
    ['concurrency',text.replace('group: financial-audit-archive','group: other')],
    ['missing push bootstrap',text.replace('  push:\n    branches: [main]\n','  push:\n    branches: [dev]\n')],
    ['missing sweep',text.replace("'23 4 * * 0'","'23 4 * * 1'")],
    ['npm',text.replace('run: node .github/scripts/financial-audit-archive.mjs verify-plan','run: npm ci && node .github/scripts/financial-audit-archive.mjs verify-plan')],
    ['approved tree',text.replace('verify-plan --input','verify-plan --root release/ --input')],
    ['clobber',text.replace('upload --input "$RUNNER_TEMP/audit-archive"','upload --input "$RUNNER_TEMP/audit-archive" --clobber')],
    ['release delete',text.replace('run: node .github/scripts/financial-audit-archive.mjs verify-public','run: gh release delete x && node .github/scripts/financial-audit-archive.mjs verify-public')],
    ['pages action',text.replace('      - uses: actions/download-artifact@v4','      - uses: actions/deploy-pages@v4\n      - uses: actions/download-artifact@v4')],
    ['continue on error',text.replace('      - name: Re-verify staged bins offline\n','      - name: Re-verify staged bins offline\n        continue-on-error: true\n')],
    ['conflicts never fail',text.replace("if: steps.collect.outputs.conflicts != '0'","if: false")],
    ['conflict check before hand-off',(()=>{const block=step(job(text,'collect'),'Fail on conflicting published archive copies'),fail=block.endsWith('\n')?block:`${block}\n`;assert.ok(text.includes(fail));return text.replace(fail,'').replace('      - uses: actions/upload-artifact@v4\n',fail+'      - uses: actions/upload-artifact@v4\n');})()],
    ['staging hand-off ungated',text.replace("        if: steps.collect.outputs.pending == 'true'\n        with:","        with:")],
    ['gh api release delete',text.replace('run: node .github/scripts/financial-audit-archive.mjs verify-public','run: gh api -X DELETE repos/x/y/releases/assets/1 && node .github/scripts/financial-audit-archive.mjs verify-public')],
    ['curl release call',text.replace('run: node .github/scripts/financial-audit-archive.mjs verify-public','run: curl -fsS https://api.github.com/repos/x/y/releases && node .github/scripts/financial-audit-archive.mjs verify-public')],
    ['upload before verify',text.replace('      - name: Re-verify staged bins offline\n        run: node .github/scripts/financial-audit-archive.mjs verify-plan --input "$RUNNER_TEMP/audit-archive"\n','').replace('      - name: Verify every staged archive copy','      - name: Re-verify staged bins offline\n        run: node .github/scripts/financial-audit-archive.mjs verify-plan --input "$RUNNER_TEMP/audit-archive"\n      - name: Verify every staged archive copy')],
  ]){assert.notEqual(changed,text,label);assert.throws(()=>checkArchiveWorkflow(changed),undefined,label);}
});

test('the publisher admits the archive from controller tooling before the approved UI checkout',()=>{
  const text=read(publisherName);assert.ok(checkPublisherStep(text));
  const name='      - name: Verify the public audit archive before omitting older carries\n';
  const block=step(job(text,'publish'),'Verify the public audit archive before omitting older carries');
  const moved=text.replace(block+'\n','').replace('      - name: Restore the exact selected data artifact\n',block+'\n      - name: Restore the exact selected data artifact\n');
  for(const [label,changed]of [
    ['moved after checkout',moved],
    ['continue on error',text.replace(name,name+'        continue-on-error: true\n')],
    ['missing token',text.replace(block,block.replace(`        env:\n${tokenLine}`,''))],
    ['secret token',text.replace(block,block.replace('${{ github.token }}','${{ secrets.ADMIN_TOKEN }}'))],
    ['limited preview',text.replace(block,block.replace(" && steps.plan.outputs.limited_research_preview != 'true'",''))],
    ['finite price',text.replace(block,block.replace(" && needs.renewal_route.outputs.price_source != 'true'",''))],
    ['approved tree command',text.replace(block,block.replace('run: node .github/scripts/','run: node release/.github/scripts/'))],
    ['job permissions',text.replace('    environment:\n      name: github-pages\n','    permissions:\n      contents: write\n    environment:\n      name: github-pages\n')],
    ['extra workflow permission',text.replace('  id-token: write\n','  id-token: write\n  packages: write\n')],
    ['extra workflow permissions',text.replace('  id-token: write\n','  id-token: write\n  deployments: write\n  issues: write\n')],
    ['third job',text+'  archive:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n'],
  ]){assert.notEqual(changed,text,label);assert.throws(()=>checkPublisherStep(changed),undefined,label);}
});

// Literal, non-reserved tags only: no workflow can mutate the audit archive.
export function checkReleaseMutations(files){
  for(const [file,text]of Object.entries(files)){
    for(const match of text.matchAll(/gh release (upload|delete|edit|delete-asset|create)\s+(\S+)/g)){
      const tag=match[2].replace(/^["']|["']$/g,'');
      assert.match(tag,/^[A-Za-z0-9][A-Za-z0-9._-]*$/,`${file}: release mutation must target a literal tag, got ${match[2]}`);
      assert.ok(!tag.startsWith('financial-audit-'),`${file}: release mutation targets the reserved audit archive prefix`);
    }
  }
  return true;
}
// REST equivalents (gh api, curl, wget): a mutating call whose target is a
// release, an upload host or a non-literal path needs a reviewed entry here,
// written as `<workflow file>: <command>`.
export const RELEASE_REST_MUTATION_ALLOWLIST=Object.freeze([]);
export function checkReleaseRestMutations(files,{allow=RELEASE_REST_MUTATION_ALLOWLIST}={}){
  for(const [file,text]of Object.entries(files)){
    for(const match of text.matchAll(/\b(gh\s+api|curl|wget)\b(?:\\\n|[^\n;|&])*/g)){
      const command=match[0].replace(/\\\n\s*/g,' ').replace(/\s+/g,' ').trim(),gh=match[1].startsWith('gh');
      const method=/(?:^|\s)(?:-X|--method|--request)(?:\s+|=)["']?([A-Za-z]+)/.exec(command)?.[1]?.toUpperCase()??null;
      const body=gh?/(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?:\s|=)/.test(command):/(?:^|\s)(?:-d|--data(?:-binary|-raw|-urlencode|-ascii)?|-F|--form|-T|--upload-file|--post-data|--post-file|--body-data|--body-file)(?:\s|=)/.test(command);
      const mutating=method!==null?!['GET','HEAD'].includes(method):body;
      if(mutating&&/releases|uploads\.github\.com|\$|\{\{/.test(command))
        assert.ok(allow.includes(`${file}: ${command}`),`${file}: a REST release mutation needs a reviewed allowlist entry: ${command}`);
    }
  }
  return true;
}
test('no workflow mutates a release under the reserved audit archive prefix',()=>{
  const directory=new URL('../workflows/',import.meta.url),files=Object.fromEntries(readdirSync(directory).filter(name=>/\.ya?ml$/.test(name)).map(name=>[name,readFileSync(new URL(name,directory),'utf8')]));
  assert.ok(checkReleaseMutations(files));
  assert.ok(checkReleaseRestMutations(files));
  assert.ok(Object.values(files).some(text=>/gh api "repos\/\$GH_REPO\/git\/ref\/heads\/main"/.test(text)),'the REST scan covers real gh api reads');
  for(const extra of ['gh api -X DELETE repos/x/y/releases/assets/1','gh api --method PATCH "repos/$GH_REPO/releases/$ID" -f draft=true','gh api repos/x/y/releases -f tag_name=financial-audit-archive-z',
    'gh api --method=DELETE "$ASSET_URL"','gh api \\\n            -X DELETE \\\n            repos/x/y/releases/assets/1','curl -X DELETE -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/x/y/releases/1',
    'curl --data-binary @a.gz https://uploads.github.com/repos/x/y/releases/1/assets?name=a.gz','wget --method=DELETE https://api.github.com/repos/x/y/releases/1'])
    assert.throws(()=>checkReleaseRestMutations({...files,'extra.yml':`        run: ${extra}\n`}),/reviewed allowlist entry/,extra);
  for(const read of ['gh api -X GET repos/x/y/releases -f per_page=100','gh api "repos/$GH_REPO/releases?per_page=100" --jq .','curl -fsSL "$site/publication.json"'])
    assert.ok(checkReleaseRestMutations({...files,'extra.yml':`        run: ${read}\n`}),read);
  assert.ok(checkReleaseRestMutations({'extra.yml':'        run: gh api -X DELETE repos/x/y/releases/assets/1\n'},{allow:['extra.yml: gh api -X DELETE repos/x/y/releases/assets/1']}),'an explicit allowlist entry admits exactly that call');
  assert.ok(Object.values(files).some(text=>/gh release upload daily-price-data/.test(text)),'the scan covers real mutations');
  for(const extra of ['gh release upload financial-audit-archive-x file','gh release delete "$TAG"','gh release edit ${{ inputs.tag }} --draft','gh release delete-asset financial-audit-archive-y a.gz'])
    assert.throws(()=>checkReleaseMutations({...files,'extra.yml':`run: ${extra}\n`}),undefined,extra);
});

test('archive workflow tests run in exact-main CI',()=>{
  const ci=read('ci.yml');
  for(const name of ['financial-audit-archive.test.mjs','financial-audit-archive-workflow.test.mjs','financial-audit-archive-lifecycle.test.mjs'])assert.ok(ci.includes(`.github/scripts/${name}`),name);
});
