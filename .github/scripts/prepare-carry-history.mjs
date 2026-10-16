// Normal carry baseline preparation only. Empty results mean no acquisition;
// they confer no source, freshness, financial admission or publisher authority.
import {lstatSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256} from './publication-state.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const regular=path=>{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid carry history input file');return readFileSync(path);};

// The unchanged provider exporter uses these qualification rules to count its
// eligible cohort. The parity test executes that exporter's needs_history too.
export function needsCarryHistory(row) {
  const methods=row.methods??{};
  if(!object(methods))throw Error('Invalid carry history qualification methods');
  for(const method of ['minervini','minervini2','ibd']){
    const value=methods[method];
    if(value!=null&&(!object(value)||(value.qualified!==undefined&&typeof value.qualified!=='boolean')))throw Error('Invalid carry history qualification');
  }
  const rules=methods.ibd?.rules??[];
  if(!Array.isArray(rules)||rules.some(rule=>!object(rule)||typeof rule.label!=='string'||!['pass','fail','unknown','not_applicable'].includes(rule.state)))throw Error('Invalid carry history qualification rules');
  if(['minervini','minervini2','ibd'].some(method=>methods[method]?.qualified===true))return true;
  const other=rules.filter(rule=>!rule.label.includes('3年'));
  return other.length>0&&other.every(rule=>rule.state==='pass');
}

function validateHistory(value,date) {
  if(!object(value)||!day(value.as_of_date)||value.as_of_date!==date||!object(value.results))throw Error('Invalid or mismatched carry history date/results');
  if(Object.hasOwn(value,'coverage')){
    const coverage=value.coverage,keys=['eligible','requested','available','four_annual_eps'];
    if(!object(coverage)||keys.some(key=>!Number.isSafeInteger(coverage[key])||coverage[key]<0)
      ||coverage.requested>coverage.eligible||coverage.available>coverage.requested
      ||coverage.four_annual_eps>coverage.requested)throw Error('Invalid carry history acquisition coverage');
  }
}

export function prepareCarryHistory({root,targetInput}) {
  for(const path of [root,join(root,'static-data')]){
    const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Linked carry history root');
  }
  const target=JSON.parse(targetInput.bytes),date=targetInput.asOfDate;
  if(!day(date)||target.market!=='US'||target.as_of_date!==date||!Array.isArray(target.rows)||!target.rows.length)throw Error('Invalid carry history target date/universe');
  const symbols=target.rows.map(row=>row?.symbol),universe=new Set(symbols);
  if(universe.size!==symbols.length||symbols.some(symbol=>typeof symbol!=='string'||!symbol.trim())
    ||target.rows.some(row=>row.market!=='US'||(row.as_of_date??date)!==date))throw Error('Invalid carry history target scope');
  const references=target.input_bindings?.files?.filter(item=>item.path==='qualification-audit.json');
  const auditBytes=regular(join(root,'qualification-audit.json'));
  if(references?.length!==1||references[0].bytes!==auditBytes.length||references[0].sha256!==sha256(auditBytes))throw Error('Carry history qualification audit is not target-bound');
  const audit=JSON.parse(auditBytes),rows=audit.results;
  if(audit.as_of_date!==date||!Array.isArray(rows)||rows.length!==universe.size
    ||new Set(rows.map(row=>row?.symbol)).size!==universe.size||rows.some(row=>!universe.has(row?.symbol)))throw Error('Carry history qualification date/universe mismatch');
  const eligible=rows.filter(needsCarryHistory).length,path=join(root,'static-data/financial-history.json');
  let existing;
  try{existing=regular(path);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing!==undefined){
    // Retained unowned symbols and their original acquisition cohort remain
    // legitimate. The unchanged carry comparator protects those exact values.
    validateHistory(JSON.parse(existing),date);
    return {created:false,sha256:sha256(existing)};
  }
  // Same metadata contract as export-financial-history.py --limit 0. These
  // counters describe zero requests, not zero underlying financial coverage.
  const payload={as_of_date:date,results:{},coverage:{eligible,requested:0,available:0,four_annual_eps:0}};
  validateHistory(payload,date);
  const bytes=JSON.stringify(payload);
  // Never overwrite an existing file, including one arriving after the read.
  writeFileSync(path,bytes,{flag:'wx'});
  return {created:true,sha256:sha256(bytes)};
}
