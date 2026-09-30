import { describe,expect,it } from 'vitest';
import { compareSnapshots,selectionState,liquidState,HISTORY_METHODS } from './candidateHistory';
const snapshot=(date,states,extra={})=>({as_of:date,rule_version:'r1',universe_version:'u1',definitions:Object.fromEntries(HISTORY_METHODS.map(m=>[m,[{id:m+':1',label:'条件',unit:'%'}]])),records:Object.entries(states).map(([symbol,state])=>({symbol,market:'US',liquid:true,methods:Object.fromEntries(HISTORY_METHODS.map(m=>[m,{state,rules:[[state,state==='pass'?80:20,null]]}]))})),...extra});
const items=(a,b,h=[])=>compareSnapshots(a,b,h).minervini.items;
describe('published candidate transitions',()=>{
  it('separates new, continued, dropped and unchanged',()=>{
    const old=snapshot('2026-09-28',{A:'fail',B:'pass',C:'pass',D:'fail'}),next=snapshot('2026-09-29',{A:'pass',B:'pass',C:'fail',D:'fail'});
    expect(items(next,old).map(i=>i.state)).toEqual(['new','continued','dropped','unchanged']);
    expect(items(next,old)[0].changes[0]).toMatchObject({id:'minervini:1',before:['fail',20,null],after:['pass',80,null]});
  });
  it('recognizes a return only with an earlier compatible saved pass',()=>{
    const old=snapshot('2026-09-28',{A:'fail'}),next=snapshot('2026-09-29',{A:'pass'}),earlier=snapshot('2026-09-25',{A:'pass'});
    expect(items(next,old,[earlier])[0].state).toBe('returned');
    expect(items(next,old,[{...earlier,rule_version:'old'}])[0].state).toBe('new');
    expect(items(next,old,[snapshot('2026-09-30',{A:'pass'})])[0].state).toBe('new');
  });
  it.each(['unknown',undefined])('never converts missing evidence into dropout (%s)',state=>{
    const next=snapshot('2026-09-29',state?{A:state}:{});
    expect(items(next,snapshot('2026-09-28',{A:'pass'}))[0].state).toBe('incomparable');
  });
  it('first snapshot is incomparable, not a new pass',()=>expect(items(snapshot('2026-09-29',{A:'pass'}),null)[0].state).toBe('incomparable'));
  it.each([{rule_version:'v2'},{universe_version:'v2'},{as_of:'2026-09-29'}])('rejects incompatible comparison %j',extra=>expect(items(snapshot('2026-09-29',{A:'pass'}),snapshot('2026-09-28',{A:'fail'},extra))[0].state).toBe('incomparable'));
  it('treats entry into the liquidity universe separately',()=>{
    const old=snapshot('2026-09-28',{A:'fail'});old.records[0].liquid=false;
    expect(items(snapshot('2026-09-29',{A:'pass'}),old)[0].state).toBe('incomparable');
  });
  it('is deterministic and retains missing liquidity as unknown',()=>{
    const a=snapshot('2026-09-29',{A:'pass'}),b=snapshot('2026-09-28',{A:'fail'});
    expect(compareSnapshots(a,b)).toEqual(compareSnapshots(a,b));
    expect(liquidState({current_price:10})).toBeNull();
    expect(selectionState({qualified:false,failed:2,unknown:1})).toBe('unknown');
  });
});
