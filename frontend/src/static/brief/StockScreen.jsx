import { memo } from 'react';
import { money } from '../positionGeometry';
import { ICON } from './briefIcons';
import { useStockData } from './useBriefData';
import StockView from './StockView';
import { DayChange } from './BriefParts';

/** Memoized: a desktop tab switch must not re-render the stock pane when its stock is unchanged. */
const StockScreen = memo(function StockScreen({ brief, symbol, watch, onToggleWatch, step, wide }) {
  const data = useStockData(symbol, brief);
  if (!brief.bundle.data) return <p className="brief-note brief-pad" role="status">候補を読み込み中…</p>;
  if (!data.item) return <p className="brief-note brief-pad">{symbol} は分析対象に含まれていません。</p>;
  const on = watch.includes(symbol);
  // The day change is the verified one (technical_audit for the analysis date), as in the rows and the bar.
  const header = wide ? <div className="brief-stockhead">
    <h2><span>{symbol}</span> <span className="numeric">{money(data.view?.price)}</span> <DayChange view={data.view} /></h2>
    <span className="brief-note">{data.view?.name}{data.view?.sector ? `・${data.view.sector}` : ''}</span>
    <span className="brief-stockhead-actions"><button type="button" className={`brief-iconbutton${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={on ? 'ウォッチから外す' : 'ウォッチに追加'} onClick={event => onToggleWatch(symbol, event.currentTarget)}>{on ? ICON.starOn : ICON.star}</button>
      <button type="button" className="brief-iconbutton" aria-label="前の候補" onClick={() => step(-1)}>{ICON.back}</button><button type="button" className="brief-iconbutton" aria-label="次の候補" onClick={() => step(1)}>{ICON.next}</button></span>
  </div> : null;
  return <StockView key={symbol} data={data} header={header} wide={Boolean(wide)} market={brief.market} />;
});

export default StockScreen;
