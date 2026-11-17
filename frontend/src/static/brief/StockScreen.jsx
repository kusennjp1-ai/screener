import { lazy, memo, Suspense, useSyncExternalStore } from 'react';
import { money } from '../positionGeometry';
import { ICON } from './briefIcons';
import { useStockData } from './useBriefData';
import { DayChange } from './BriefParts';
import { barDay } from './briefNav';
import { loadedStockView, loadStockView, stockViewFailed, subscribeStockView } from './stockViewLoader';

/** What the stock screen says when its own chunk cannot be loaded (the chart box's words, for the screen). */
const STOCK_FAILED_TEXT = '銘柄の画面を読み込めません（通信状態を確認して、再読み込みしてください）';

/**
 * The stock screen's body when its chunk could not be loaded (offline before the service worker had it, or a deploy
 * replaced it): the message and a 44px 再読み込み, never an empty screen. The browser keeps a failed module import for
 * the page's life, so the button reloads the page, as the chart box's does. Should a later load succeed, the screen draws.
 */
function StockViewUnavailable(props) {
  const chunk = useSyncExternalStore(subscribeStockView, loadedStockView, loadedStockView);
  const View = chunk?.default;
  if (View) return <View {...props} />;
  return <div className="brief-stock">
    {props.header}
    <div className="brief-stock-failed"><p role="alert">{STOCK_FAILED_TEXT}</p><button type="button" onClick={() => window.location.reload()}>再読み込み</button></div>
  </div>;
}
const UNAVAILABLE = { default: StockViewUnavailable };
// A module already in hand is handed to React.lazy as a thenable that resolves at once, so the screen renders in the same
// pass (no fallback frame: a phone opens a stock once its chunk has settled, BriefApp). A failed load resolves to the
// message above, so React never sees a thrown import.
const at = chunk => ({ then: resolve => resolve(chunk) });
const StockView = lazy(() => (loadedStockView() ? at(loadedStockView()) : stockViewFailed() ? at(UNAVAILABLE) : loadStockView().catch(() => UNAVAILABLE)));

/** While the chunk loads: the screen's own loading line, under the desktop header (the pane keeps its place). */
const StockPending = ({ header }) => <div className="brief-stock">{header}<p className="brief-note brief-pad" role="status">銘柄データを読み込み中…</p></div>;

/**
 * Memoized: a desktop tab switch must not re-render the stock pane when its stock is unchanged. `ageLine`
 * (briefFreshness' freshnessLine, or null) puts the late publication's date line in the desktop header too.
 */
const StockScreen = memo(function StockScreen({ brief, symbol, watch, onToggleWatch, step, wide, ageLine = null }) {
  const data = useStockData(symbol, brief);
  if (!brief.bundle.data) return <p className="brief-note brief-pad" role="status">候補を読み込み中…</p>;
  if (!data.item) return <p className="brief-note brief-pad">{symbol} は分析対象に含まれていません。</p>;
  const on = watch.includes(symbol);
  // The day change is the verified one (technical_audit for the analysis date), as in the rows and the bar.
  const header = wide ? <div className="brief-stockhead">
    <h2><span>{symbol}</span> <span className="numeric">{money(data.view?.price)}</span> <DayChange view={data.view} /></h2>
    <span className="brief-note">{data.view?.name}{data.view?.sector ? `・${data.view.sector}` : ''}</span>
    {ageLine && brief.date ? <span className={`brief-note numeric brief-stockhead-age is-${ageLine.tone}`}>分析基準日 <time dateTime={brief.date}>{barDay(brief.date)}</time>引け・{ageLine.age}{ageLine.detail}</span> : null}
    <span className="brief-stockhead-actions"><button type="button" className={`brief-iconbutton${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={on ? 'ウォッチから外す' : 'ウォッチに追加'} onClick={event => onToggleWatch(symbol, event.currentTarget)}>{on ? ICON.starOn : ICON.star}</button>
      <button type="button" className="brief-iconbutton" aria-label="前の候補" onClick={() => step(-1)}>{ICON.back}</button><button type="button" className="brief-iconbutton" aria-label="次の候補" onClick={() => step(1)}>{ICON.next}</button></span>
  </div> : null;
  return <Suspense fallback={<StockPending header={header} />}><StockView key={symbol} data={data} header={header} wide={Boolean(wide)} market={brief.market} /></Suspense>;
});

export default StockScreen;
