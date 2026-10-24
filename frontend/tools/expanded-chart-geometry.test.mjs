import { describe, expect, it } from 'vitest';
import { checkExpandedChartGeometry } from './expanded-chart-geometry.mjs';

const fitted = {
  plot: { height: 457, bottom: 845 }, date_axis: { height: 26 }, footer: { top: 845 },
  plot_visible: true, date_axis_visible: true, date_axis_hit: true, date_axis_canvases: 4,
  footer_visible: true, footer_hit: true, close_visible: true, close_hit: true,
  footer_controls: [{ text: '次の銘柄', visible: true, hit: true }],
};
const failuresFor = (overrides, fullChart = true) => {
  const failures = [];
  checkExpandedChartGeometry({ ...fitted, ...overrides }, (passes, message) => { if (!passes) failures.push(message); }, 'fixture', { fullChart });
  return failures;
};

describe('expanded chart browser acceptance checks', () => {
  it('accepts a real-sized axis above an unobscured footer', () => {
    expect(failuresFor({})).toEqual([]);
  });
  it('rejects the old clipped plot even when chart canvases exist', () => {
    const failures = failuresFor({ plot: { height: 540, bottom: 928 }, plot_visible: false, date_axis_visible: false, date_axis_hit: false });
    expect(failures).toEqual(expect.arrayContaining([
      expect.stringContaining('complete plot/date axis'), expect.stringContaining('extends behind footer'),
    ]));
  });
  it('rejects footer and close controls covered by a higher-stacked chart', () => {
    expect(failuresFor({ footer_hit: false, close_hit: false, footer_controls: [{ text: '次の銘柄', visible: true, hit: false }] })).toHaveLength(3);
  });
  it('allows intentional small-viewport scrolling, but never a collapsed plot or missing date axis', () => {
    expect(failuresFor({ plot_visible: false, date_axis_visible: false, date_axis_hit: false }, false)).toEqual([]);
    expect(failuresFor({ plot: { height: 0 }, date_axis_canvases: 0 }, false)).toHaveLength(2);
  });
  it('requires mobile to use available plot space between the readable minimum and normal cap', () => {
    const mobile = { viewport:{width:390,height:568},content:{top:97},content_client_height:446,scroll_top:0,plot:{top:233,bottom:543,height:310},footer:{top:543} };
    expect(failuresFor(mobile,false)).toEqual([]);
    expect(failuresFor({...mobile,plot:{top:233,bottom:653,height:420}},false)).toContainEqual(expect.stringContaining('readable 300–420px'));
    expect(failuresFor({...mobile,plot_visible:false},false)).toContainEqual(expect.stringContaining('complete plot/date axis'));
    expect(failuresFor({...mobile,content_client_height:402,footer:{top:499},plot:{top:233,bottom:533,height:300},plot_visible:false,date_axis_visible:false,date_axis_hit:false},false)).toEqual([]);
    expect(failuresFor({...mobile,content_client_height:678,footer:{top:775},plot:{top:233,bottom:653,height:420}},false)).toEqual([]);
  });
  it('requires the full short-phone plot with 44px header navigation clear of the close control', () => {
    const compact={viewport:{width:390,height:568},content:{top:140,bottom:568},content_client_height:428,scroll_top:0,
      plot:{top:266,bottom:568,height:302},footer:{top:4,bottom:48,left:234,right:326},close:{left:330,right:374,top:4,bottom:48},footer_placement:'header',navigation_count:2,
      footer_controls:['前','次'].map(text=>({text,visible:true,hit:true,rect:{width:44,height:44}}))};
    expect(failuresFor(compact)).toEqual([]);
    expect(failuresFor({...compact,plot_visible:false,date_axis_visible:false,date_axis_hit:false})).toContainEqual(expect.stringContaining('complete plot/date axis'));
    expect(failuresFor({...compact,footer:{...compact.footer,right:331}})).toContainEqual(expect.stringContaining('overlaps'));
    expect(failuresFor({...compact,footer_controls:[{text:'前',visible:true,hit:true,rect:{width:24,height:24}}]})).toEqual(expect.arrayContaining([expect.stringContaining('controls are missing'),expect.stringContaining('smaller than 44px')]));
    expect(failuresFor({...compact,footer_visible:false,footer_hit:false,navigation_count:0,footer_controls:[]})).toEqual([]);
    const warning={left:16,right:374,top:100,bottom:135};
    expect(failuresFor({...compact,warning,warning_visible:true})).toEqual([]);
    expect(failuresFor({...compact,warning:{...warning,top:0,bottom:70},warning_visible:true})).toContainEqual(expect.stringContaining('warning is clipped or covered'));
    expect(failuresFor({...compact,close:{...compact.close,top:74,bottom:118}})).toContainEqual(expect.stringContaining('outside the title row'));
  });
});


describe('versioned SVG expanded chart evidence', () => {
  const svg = { renderer:'leader-svg-v1', date_axis_canvases:0, date_axis_labels:['08-01','09-01','10-02'] };
  it('accepts the actual SVG date labels without pretending canvases exist', () => {
    expect(failuresFor(svg)).toEqual([]);
  });
  it.each([null, [], [''], ['08-01']])('rejects missing or incomplete SVG date labels %j', labels => {
    expect(failuresFor({...svg,date_axis_labels:labels})).toContainEqual(expect.stringContaining('date-axis row is missing'));
  });
  it('rejects collapsed, off-screen or covered SVG dates', () => {
    expect(failuresFor({...svg,date_axis:{height:15}})).toContainEqual(expect.stringContaining('date-axis row is missing'));
    expect(failuresFor({...svg,date_axis_visible:false})).toContainEqual(expect.stringContaining('complete plot/date axis'));
    expect(failuresFor({...svg,date_axis_hit:false})).toContainEqual(expect.stringContaining('complete plot/date axis'));
  });
  it('does not let SVG labels bypass legacy canvas evidence or an unknown renderer', () => {
    expect(failuresFor({...svg,renderer:undefined})).toContainEqual(expect.stringContaining('date-axis row is missing'));
    expect(failuresFor({...svg,renderer:'unknown',date_axis_canvases:4})).toContainEqual(expect.stringContaining('unknown chart renderer'));
  });
});
