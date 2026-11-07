import MetricDisclosure from '../components/MetricDisclosure';
import { shortDate } from './briefModel';
import { sectorRanks } from './marketTabHistory';

/**
 * Sector ETFs ranked by this app's own relative strength (相対力: never called RS, which on this app is the
 * stocks' RS推計) on the newest frame. The value is shown as
 * published (100 = the same move as SPY) and the bar is that value centred on 100; the rank a month
 * earlier is said in words and with ▲▼, never by colour alone. The frame keeps its own date.
 */
export default function MarketSectors({ history, date }) {
  if (!history) return null;
  const view = sectorRanks(history, date);
  return <section className="brief-sectors" aria-labelledby="brief-sectors-title">
    <header>
      <div><h3 id="brief-sectors-title">セクターの強さ</h3><span>相対力（SPY比・126営業日・100基準・独自）</span></div>
      {view.date && <span className={`brief-stamp numeric${view.older ? ' is-older' : ''}`}><span aria-hidden="true">◷</span> {shortDate(view.date, date)}{view.older ? '時点' : ' 引け'}</span>}
    </header>
    {!view.complete ? <p className="brief-note">{view.date ? 'この日の11セクターすべてを確認できません。' : 'セクターの順位は公開データに含まれていません。'}</p>
      : <ol className="brief-sector-list" aria-label={`${view.date}のセクター順位。126営業日の相対力（SPY比・100基準）。`}>
        {view.rows.map(row => <li key={row.symbol} aria-label={`${row.rank}位 ${row.name} ${row.symbol} 相対力 ${row.text}${row.was === null ? '' : row.move === 0 ? '・1か月前と同じ順位' : `・1か月前は${row.was}位`}`}>
          <b className="brief-sector-rank numeric" aria-hidden="true">{row.rank}</b>
          <span className="brief-sector-name" aria-hidden="true">{row.name}<small>{row.symbol}</small></span>
          <span className="brief-sector-bar" aria-hidden="true"><i className={row.up ? 'is-up' : 'is-down'} style={row.up ? { left: '50%', width: `${row.width.toFixed(1)}%` } : { right: '50%', width: `${row.width.toFixed(1)}%` }} /></span>
          <span className="brief-sector-value numeric" aria-hidden="true">{row.text}</span>
          <span className={`brief-sector-move numeric${row.move > 0 ? ' is-up' : row.move < 0 ? ' is-down' : ''}`} aria-hidden="true">{row.move === null ? '' : row.move > 0 ? `▲${row.move}` : row.move < 0 ? `▼${-row.move}` : '±0'}</span>
        </li>)}
      </ol>}
    {view.complete && <p className="brief-note">数値は126営業日前を100としたSPY比（100＝SPYと同じ騰落）。棒は100より右がSPYより強く、左が弱い。{view.beforeDate ? `▲▼は1か月前（${shortDate(view.beforeDate, date)}）からの順位の変化です。` : '1か月前の順位はまだありません。'}</p>}
    <MetricDisclosure summary="相対力の計算方法・出典"><p>126営業日前を100として、（ETF終値 ÷ SPY終値）の変化を計算。高い順に1〜11位、同値は同順位です。欠測日は順位を作りません。価格は分割調整済み・配当再投資なし。11のSelect Sector SPDR ETFの比較で、IBDの業種グループ分類・公式RSとは異なります。</p><a href="https://www.ssga.com/us/en/individual/capabilities/equities/sector-investing/select-sector-etfs" target="_blank" rel="noreferrer">State StreetのセクターETF一覧 ↗</a></MetricDisclosure>
  </section>;
}
