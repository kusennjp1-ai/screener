import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {expect as baseExpect} from '@playwright/test';

const expect=baseExpect.configure({timeout:45000});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const num=(value,digits=1)=>Number.isFinite(value)?value.toLocaleString('ja-JP',{maximumFractionDigits:digits}):'未確認';
function windowMonths(points,months,asOf){
 const end=new Date(asOf+'T00:00:00Z'),start=new Date(end);start.setUTCDate(1);start.setUTCMonth(start.getUTCMonth()-months);start.setUTCDate(Math.min(end.getUTCDate(),new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate()));
 return points.filter(point=>point.date>=start.toISOString().slice(0,10)&&point.date<=asOf);
}
const readout=async region=>({date:await region.locator('.market-trend-readout time').textContent(),readout:await region.locator('.market-trend-readout').textContent()});

// Functional observations are additional authenticated report data. Existing
// PNG names and historical screenshot contracts remain unchanged.
export async function verifyMarketHistoryCases({page,viewport,theme,report,currentUrl,currentRoot}){
 const record={viewport,theme};report.market_history_cases||=[];
 const reducedBefore=await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 try{
  const manifest=JSON.parse(await readFile(resolve(currentRoot,'static-data/manifest.json'),'utf8')),entry=manifest.markets.US,ref=entry.assets.market_trends;
  const seriesBytes=await readFile(resolve(currentRoot,'static-data',ref.path));assert.equal(sha(seriesBytes),ref.sha256);
  const series=JSON.parse(seriesBytes),history=series.long_history;assert(history?.source_sha256);
  const raw=await readFile(resolve(currentRoot,'static-data/market-trends',`history-source-${history.source_sha256}.json`));assert.equal(sha(raw),history.source_sha256);
  const {source_sha256:ignored,...embedded}=history;void ignored;assert.deepEqual(JSON.parse(raw),embedded);
  const source={market_series_sha256:ref.sha256,history_source_sha256:history.source_sha256,raw_text:raw.toString('utf8')};
  if(report.market_history_source)assert.deepEqual(report.market_history_source,source);else report.market_history_source=source;
  record.as_of_date=history.as_of_date;
  await page.goto(`${currentUrl}#/breadth`);const market=page.getByRole('region',{name:'市場指標の推移',exact:true});await expect(market).toBeVisible();
  await expect(page.locator('.leader-shell')).toHaveAttribute('data-theme',theme);record.observed_theme=await page.locator('.leader-shell').getAttribute('data-theme');
  await market.getByRole('tab',{name:'新高値・安値',exact:true}).click();await market.getByRole('button',{name:'5年',exact:true}).click();
  const five=windowMonths(history.breadth,60,series.as_of_date);assert(five.length>=1200);
  const slider=market.getByRole('slider');await expect(slider).toHaveAttribute('max',String(five.length-1));await slider.fill('0');
  const first=await readout(market);assert.equal(first.date,five[0].date);assert(first.readout.includes(`新高値 ${num(five[0].newHighs)}銘柄`)&&first.readout.includes(`新安値 ${num(five[0].newLows)}銘柄`));
  const sp=history.sp500.find(point=>point.date===first.date);assert(sp&&first.readout.includes(`S&P 500（右軸） ${num(sp.close)}pt`));
  await slider.fill(String(five.length-1));const last=await readout(market);assert.equal(last.date,five.at(-1).date);
  await expect(market.locator('svg path')).toHaveCount(3);record.highlow={months:60,count:five.length,first,last,secondary_axis:true};
  await page.locator('summary').filter({hasText:'選定対象と業種別の広がり'}).click();
  const breadth=page.getByRole('region',{name:'選定対象の価格条件と先導株の長期推移',exact:true});await breadth.getByRole('button',{name:'2年',exact:true}).click();
  const two=windowMonths(history.breadth,24,history.as_of_date);assert(two.length>=500);await expect(breadth.getByRole('slider')).toHaveAttribute('max',String(two.length-1));await breadth.getByRole('slider').fill('0');
  const leader=await readout(breadth);assert.equal(leader.date,two[0].date);assert(leader.readout.includes(`${num(two[0].leaderCount)}銘柄`));
  await breadth.getByRole('button',{name:'50日線上',exact:true}).click();await breadth.getByRole('combobox',{name:'業種別推移の対象'}).selectOption('Technology');await breadth.getByRole('slider').fill('0');
  const technology=await readout(breadth),tech=windowMonths(history.sectorBreadth.find(group=>group.sector==='Technology').points,24,history.as_of_date);assert.equal(technology.date,tech[0].date);assert(technology.readout.includes(`${num(tech[0].above50Percent)}%`));
  await breadth.getByRole('button',{name:'4%騰落・10日レシオ',exact:true}).click();await expect(breadth.getByRole('combobox',{name:'業種別推移の対象'})).toBeDisabled();await breadth.getByRole('slider').fill('0');const ratio=await readout(breadth);assert.equal(ratio.date,two[0].date);assert(ratio.readout.includes(`${num(two[0].ratio_10day,2)}倍`));
  record.breadth={months:24,count:two.length,firstDate:two[0].date,lastDate:two.at(-1).date,leader_first:leader,technology_first:technology,ratio_first:ratio};
  const rotation=page.getByRole('region',{name:'セクターETFの独自RS順位の推移',exact:true}),frames=history.sectorRotation.frames;assert(frames.length>=250);
  await expect(rotation.getByRole('slider')).toHaveAttribute('max',String(frames.length-1));await expect(rotation.getByRole('button',{name:'▶ 再生',exact:true})).toHaveAttribute('aria-pressed','false');
  await rotation.getByRole('slider').fill('0');await expect(rotation.locator('time')).toHaveText(frames[0].date);
  const firstRanks=[];for(const row of frames[0].ranks){const item=rotation.getByRole('listitem').filter({hasText:row.symbol});await expect(item).toHaveCount(1);await expect(item.locator('.sector-rank-number')).toHaveText(String(row.rank));firstRanks.push({...row,text:await item.getAttribute('aria-label')});}
  await rotation.getByRole('button',{name:'▶ 再生',exact:true}).click();await expect(rotation.locator('time')).not.toHaveText(frames[0].date);const played=await rotation.locator('time').textContent();await rotation.getByRole('button',{name:'Ⅱ 一時停止',exact:true}).click();const paused=await rotation.locator('time').textContent();await page.waitForTimeout(1000);await expect(rotation.locator('time')).toHaveText(paused);const pausedEnd=await rotation.locator('time').textContent();
  await rotation.getByRole('button',{name:'▶ 再生',exact:true}).click();await rotation.getByRole('slider').fill('0');await expect(rotation.getByRole('button',{name:'▶ 再生',exact:true})).toHaveAttribute('aria-pressed','false');await expect(rotation.locator('time')).toHaveText(frames[0].date);
  await page.emulateMedia({reducedMotion:'reduce'});const transitions=await rotation.locator('.history-sector-rank-row').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).transitionDuration));assert(transitions.length===11&&transitions.every(value=>value==='0s'));
  record.rotation={count:frames.length,firstDate:frames[0].date,lastDate:frames.at(-1).date,firstRanks,initial_stopped:true,played_date:played,paused_date:paused,paused_end_date:pausedEnd,pause_observed_ms:1000,scrub_stopped:true,scrub_date:frames[0].date,reduced_transitions:transitions};
  await page.getByRole('tab',{name:'業種の強さ',exact:true}).click();const sectors=page.getByRole('region',{name:'業種の相対強度と通過率',exact:true});await expect(sectors).toBeVisible();
  const rows=sectors.locator('.sector-rank-list .sector-rank-row');await expect(rows).toHaveCount(12);const positions=await rows.evaluateAll(nodes=>nodes.map(node=>({position:getComputedStyle(node).position,top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height})));
  assert(positions.every((row,i)=>row.position!=='absolute'&&(!i||row.top>=positions[i-1].top+positions[i-1].height-1)));record.old_sector_bars={count:positions.length,positions};
  await sectors.getByRole('button',{name:'表',exact:true}).click();await expect(sectors.getByRole('table',{name:'業種の相対強度一覧'})).toBeVisible();record.old_sector_table=true;
  record.horizontal_overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(record.horizontal_overflow,false);
 }catch(error){record.error=error.message;report.failures.push(`Market history ${viewport.width}/${theme}: ${error.message}`);}
 finally{report.market_history_cases.push(record);await page.emulateMedia({reducedMotion:reducedBefore?'reduce':'no-preference'});}
 return record;
}
