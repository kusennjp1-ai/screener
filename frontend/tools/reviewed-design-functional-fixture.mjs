// Synthetic metadata-only fixtures; never real capture or publication evidence.
import { requiredScreeningCaptures, DESIGN_GROUPS } from './screening-priority-acceptance.mjs';
import { FINANCIAL_DESIGN_CASES, financialDesignScreens } from './financial-design-cases.mjs';
import { CHART_DESIGN_SYMBOLS } from './chart-design-cases.mjs';
const H = 'a'.repeat(64), C = 'b'.repeat(40), day = '2026-10-21';
const tableNames = ['ミネルヴィニ合格 注目銘柄 トップ20の表（横スクロール）', '主導業種グループの主導銘柄の表（横スクロール）', 'テクニカル参考候補 トップ20の表（横スクロール）', '業種グループ トップ10の表（横スクロール）'];
const height = width => width === 1440 ? 900 : 844;
const rect = (top = 0, width = 100, height = 100, left = 0) => ({ top, bottom: top + height, width, height, left, right: left + width });
function expanded(width, h, scrolled = false) {
  const available = h - 104, plotHeight = width === 390 ? Math.min(420, Math.max(300, available)) : Math.min(500, available);
  const top = scrolled ? 10 : 60;
  return { viewport: { width, height: h }, plot: rect(top,width,plotHeight), date_axis: rect(top+plotHeight-28,width,28), footer:rect(h-44,width,44),content:rect(60,width,available),close:rect(8,44,44,width-44),warning:null,warning_visible:null,
    scroll_top:scrolled?50:0,scroll_height:h+200,content_client_height:available,plot_visible:true,date_axis_visible:true,date_axis_hit:true,date_axis_canvases:1,footer_visible:true,footer_hit:true,footer_position:'relative',footer_placement:'footer',navigation_count:0,footer_controls:[],close_visible:true,close_hit:true };
}
function selectors(name) {
  if(name==='daily-observations')return ['[data-testid="todays-buys-row-SYNTHETIC"]'];
  if(name==='daily-watchlist')return ['[data-testid="watchlist-row-SYNTHETIC"]'];
  if(name.endsWith('-annual-viewport'))return ['.financial-evidence-heading h4','.financial-evidence-status','.financial-evidence-value strong','.financial-evidence-value span',...[1,2,3].map(n=>`.financial-evidence-metadata > div:nth-child(${n})`)].map(s=>'#financial-evidence-annual_eps_growth_3y '+s);
  if(name.endsWith('-evidence'))return ['#financial-evidence-eps_growth_yy'];
  if(name.endsWith('-selection'))return ['#detail-panel-evidence > h3',...[1,2,3].map(n=>`#detail-panel-evidence .research-rules > li:nth-child(${n})`)];
  if(name.endsWith('-purchase'))return ['#detail-panel-conditions > h3',...[1,2].map(n=>`#detail-panel-conditions .condition-rules > li:nth-child(${n})`)];
  if(name.endsWith('-history'))return ['#detail-panel-financial > details.research-disclosure > summary',name.startsWith('carry-')?'#detail-panel-financial > details.research-disclosure > p':'#detail-panel-financial > details.research-disclosure > :nth-child(2)'];
  throw Error('Unknown synthetic scoped screen');
}
function screen(key, scope) {
  const [name,w] = key.split('/'), width = Number(w), h = name.endsWith('-expanded-short') ? width === 1440 ? 760 : 568 : height(width);
  const m = { smallTargets:[],fontIssues:[],radiusIssues:[],asciiNegativeValues:[],heroActionTargets:[],scrollY:0,horizontalOverflow:false,pageHeight:h,viewport:{width,height:h},headerHeight:56,bottomNavHeight:width===390?50:0,chromeHeight:width===390?106:56,hero:rect(56,300,200),firstRow:rect(250,300,50),chart:rect(350,300,300),chartCard:rect(350,300,400),detail:rect(200,300,600),visibleCandidates:12,firstScanCard:null,visibleScanCards:0,visibleCompareCards:6,visibleCompareCardFraction:2,comparisonGrid:rect(100,300,600),runningAnimations:0 };
  const result={key,screenshot:key.replaceAll('/','-')+'.png',sha256:H,metrics:m,axe:[],reduced_motion_running_animations:0,...(scope==='carry'?{preview_provenance_sha256:H}:{})};
  if(name==='scan')result.sparkline_columns=width===1440?[{id:'rs_trend',geometry:20},{id:'price_change_1d',geometry:20}]:[];
  if(/^(?:carry-)?financial-/.test(name)||name.startsWith('daily-')) {
    result.screenshot_scope='scrolled-viewport';result.screenshot_target=null;result.metrics_scope='original-viewport';
    result.viewport_geometry={viewport:{width,height:h},scroll_y:0,chrome:{header:rect(0,width,56),navigation:width===390?rect(h-50,width,50):null},content:{top:56,bottom:h-(width===390?50:0),left:0,right:width},targets:selectors(name).map(selector=>({selector,count:1,shown:true,rect:rect(100,100,100),clip:{top:56,bottom:h-50,left:0,right:width},hit_samples:Array(9).fill(true),text:'Synthetic target'}))};
  }
  return result;
}
function views(names) { return names.map(screen=>({screen,scope:'scrolled-viewport',targets:selectors(screen)})); }
function finance(item,width,carry) {
  const theme=width===1440?'dark':'light',prefix=carry?'carry-':'', rows=['eps_growth_yy','sales_growth_yy','annual_eps_growth_3y','eps_rating','composite_rating','roe','profit_margin'].map((id,i)=>({id,state:i<3?'unknown':'reference',role:i<3?'必須':'参考',actual:'未確認',condition:'Synthetic condition',status:'? 未確認',text:'Synthetic row',explanation:'Synthetic missing source',metadata:Object.fromEntries(['対象期','提供元','取得','指標','基準','単位'].map(key=>[key,'Synthetic source label']))}));
  const selection={passed:0,total:3,failed:0,unknown:3,heading:'選定 0/3 · 未達 0 · 未確認 3',rules:Array(3).fill('Synthetic rule')};
  const row={symbol:item.symbol,as_of_date:day,method:'oneil',qualified:'false',passed:'0',total:'3',unknown:'3',failed_count:'0',unknown_count:'3'};
  const result={symbol:item.symbol,category:item.category,viewport:{width,height:height(width)},theme,method:'oneil',as_of_date:day,research_generation:H,financial_evaluated_at:'2026-10-22T12:00:00.000Z',source:{unknown:3,qualified:false},history_status:'unavailable',financial_rows:rows,financial_summary:{required:3,failed:0,unknown:3,heading:'財務の必須条件 3件 · 未達 0件 · 未確認 3件'},selection,purchase:{...selection,heading:'購入条件 0/3 · 未達 0 · 未確認 3 · 未接続'},csv:{source:'actual browser download',filename:'synthetic.csv',headers:Object.keys(row),row},views:views(financialDesignScreens({width},theme).filter(name=>name.startsWith('financial-'+item.symbol+'-')).map(name=>prefix+name))};
  if(carry)Object.assign(result,{evidence_kind:'supplemental-expired-carry',satisfies_fresh_category:false,preview_provenance_sha256:H,history_withheld:{tables:0,annual_points:0,text:'Synthetic expired history'},csv:{...result.csv,validation:'passed',artifact:'synthetic-'+item.symbol+'-'+width+'.csv',sha256:H,bytes:10,observed_browser_at:'2026-10-22T12:00:00.000Z'}});
  return result;
}
export function fixture(scope='carry') {
  const binding={scope,commit:C,provenance_sha256:H,as_of_date:day,research_generation:H},report={commit:C,input_basis:'same_verified_input',data:{as_of_date:day,research_generation:H},screens:requiredScreeningCaptures(scope).map(key=>screen(key,scope)),failures:['Timing warning stays unchanged'],performance:[]};
  report.chart_cases=DESIGN_GROUPS.flatMap(group=>CHART_DESIGN_SYMBOLS.map(symbol=>{const [w,theme]=group.split('/'),width=Number(w);return {symbol,viewport:{width,height:height(width)},theme,as_of_date:day,bars:300,history_warning:null,annotation_candidate:false,annotation_summary:'Synthetic annotation',shapes:[],canonical:{pivot:100,upper:105,stop:92},views:['inline-default','expanded-default','expanded-annotations'].map(view=>({view,symbol,as_of_date:day,annotation_mode:width===390&&view==='inline-default'?'simple':'detail',pivot:'100',upper:'105',stop:'92'})),source_warning:{expected:true,inline_visible:true,[width===390?'mobile_expanded_visible':'desktop_expanded_visible']:true},expanded_geometry:expanded(width,height(width)),expanded_short_geometry:expanded(width,width===1440?760:568),expanded_scrolled_geometry:expanded(width,480,true),expanded_reopened_geometry:expanded(width,height(width)),selected_one_month_range:'2026-09/2026-10',visual_overlap_review:'Separate actual image review required'};}));
  report.financial_cases=[1440,390].flatMap(width=>FINANCIAL_DESIGN_CASES.map(item=>finance(item,width,false)));
  report.daily_observations=[1440,390].map(width=>({viewport:{width,height:height(width)},theme:width===1440?'dark':'light',source:{symbol:'SYNTHETIC',index_path:'synthetic-index.json',as_of_date:day,buy:{last_close:100,trigger_price:100},sell:{}},initial_rows:{count:1,symbols:['SYNTHETIC']},displayed:{observation:`記録終値 100.00 · シグナル基準値 100.00 · 配信基準日 ${day} · 旧モデルの確認項目 未確認 · 記録時のシグナル 未確認 · 検出経路 未確認 · テクニカル観測のみ · 購入条件は未判定`,watch:`配信基準日 ${day} · 売却モデル参考 · 実際の保有・注文は未確認`,freshness:'unverified'},watch_keyboard_added:true,watch_keyboard_removed:true,research_keyboard_destination:{symbol:'SYNTHETIC',hash:'#/?symbol=SYNTHETIC'},views:views(['daily-observations','daily-watchlist']),table_keyboard_scroll:tableNames.map(name=>({name,width:300,content:400,moved:true}))}));
  if(scope==='carry'){report.financial_carry_cases=[1440,390].flatMap(width=>FINANCIAL_DESIGN_CASES.map(item=>finance(item,width,true)));report.financial_carry_browser_ui=DESIGN_GROUPS.map(group=>{const[w,theme]=group.split('/'),width=Number(w);return{viewport:{width,height:height(width)},theme,provenance_sha256:H,observations:['index.html','assets/synthetic.js'].map(path=>({path,sha256:H,bytes:10,source:'actual browser response'}))};});}
  return {report,binding};
}
