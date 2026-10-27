import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import RsRatingHistory from './RsRatingHistory';
import { RS_METHOD } from '../qualificationAudit';
afterEach(cleanup);
const history={schema_version:'published-universe-rs-history-v1',symbol:'TEST',as_of_date:'2026-10-23',method:RS_METHOD,basis:'current_verified_publication_universe_recalculated',source:'verified_daily_ohlcv',current_universe_size:110,sessions:['2026-10-21','2026-10-22','2026-10-23'],points:[{time:'2026-10-21',value:75,universe_size:100},{time:'2026-10-23',value:85,universe_size:110}]};
it('shows current rating, dated history, population and missing-session gaps with closed methodology',()=>{
 const {container}=render(<RsRatingHistory history={history} symbol="TEST" date="2026-10-23" current={85}/>);
 expect(container.querySelector('summary')).toHaveTextContent('85 / 99');
 expect(container.querySelector('details')).not.toHaveAttribute('open');
 expect(container.querySelectorAll('polyline')).toHaveLength(2);
 fireEvent.change(screen.getByRole('combobox',{name:'RS順位の対象日'}),{target:{value:'2026-10-21'}});
 expect(container.querySelector('summary')).toHaveTextContent('75 / 99');
 expect(container.querySelector('summary')).toHaveTextContent('2026-10-21');
 expect(container.querySelector('output')).toHaveTextContent('比較対象 100銘柄');
 expect(container.querySelector('.rs-history-current')).toHaveTextContent('最新 2026-10-23 · RS 85 / 99');
 fireEvent.change(screen.getByRole('combobox',{name:'RS順位の対象日'}),{target:{value:'2026-10-23'}});
 expect(container.querySelector('summary')).toHaveTextContent('85 / 99');
 expect(container.textContent).toContain('当時公表された順位ではありません');
});
it.each(['symbol','date','current','order','future','population','method'])('withholds %s mismatches without substituting the price-ratio line',kind=>{
 const input=structuredClone(history);let current=85;
 if(kind==='symbol')input.symbol='OTHER';if(kind==='date')input.as_of_date='2026-10-22';if(kind==='current')current=90;
 if(kind==='order')input.points.reverse();if(kind==='future')input.points.push({time:'2026-10-26',value:86,universe_size:110});
 if(kind==='population')input.points[0].universe_size=99;if(kind==='method')input.method='price-ratio';
 const {container}=render(<RsRatingHistory history={input} symbol="TEST" date="2026-10-23" current={current}/>);
 expect(container.querySelector('svg')).toBeNull();expect(container.textContent).toContain('価格比のRS線で代用しません');
});

it.each(['null-last-point', 'null-first-point', 'sparse-points', 'sparse-sessions'])('withholds malformed %s without crashing the stock chart', kind => {
 const input = structuredClone(history);
 if (kind === 'null-last-point') input.points[input.points.length - 1] = null;
 if (kind === 'null-first-point') input.points[0] = null;
 if (kind === 'sparse-points') delete input.points[0];
 if (kind === 'sparse-sessions') delete input.sessions[1];
 const { container } = render(<RsRatingHistory history={input} symbol="TEST" date="2026-10-23" current={85}/>);
 expect(container.querySelector('summary')).toHaveTextContent('85 / 99');
 expect(container.querySelector('svg')).toBeNull();
 expect(container.textContent).toContain('比較可能なRS順位履歴は未配信です');
});
