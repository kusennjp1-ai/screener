import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTopGroupsHaveGroupSource} from './materialize-retained-price-graph.mjs';

test('home top groups without a source groups page fail closed instead of skipping the aggregate proof',()=>{
  assert.throws(()=>assertTopGroupsHaveGroupSource(null,{top_groups:[{industry_group:'Semiconductors',top_symbol:'NVDA'}]}),/Aggregate dependency proof requires the source groups page/);
  // A malformed top_groups value is not evidence of "no groups" either.
  assert.throws(()=>assertTopGroupsHaveGroupSource(null,{top_groups:{industry_group:'Semiconductors'}}),/Aggregate dependency proof requires/);
});

test('no published top groups, or a manifest that still names the groups page, keeps the existing checks',()=>{
  for(const home of [{},{top_groups:[]},{top_groups:null}])assert.doesNotThrow(()=>assertTopGroupsHaveGroupSource(null,home));
  // With the groups page the full source-bound aggregate proof runs as before.
  assert.doesNotThrow(()=>assertTopGroupsHaveGroupSource('static-data/markets/us/groups.json',{top_groups:[{industry_group:'Semiconductors'}]}));
});
