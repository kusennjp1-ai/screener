import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { researchFeedContext } from '../researchFeedContext';

export function ResearchFeedNavigation({ detailOpen, onBrowse, onlyWatch, onWatchFilter }) {
  return <nav className="research-feed-navigation" aria-label="リサーチの移動">
    <p className="feed-navigation-caption">RESEARCH</p>
    <button className={!onlyWatch ? 'is-current' : ''} onClick={onBrowse}><span aria-hidden="true">◉</span>{detailOpen ? 'フィードへ戻る' : '銘柄フィード'}</button>
    <button className={onlyWatch ? 'is-current' : ''} aria-pressed={onlyWatch} onClick={onWatchFilter}><span aria-hidden="true">☆</span>ウォッチ</button>
    <Link to="/compare"><span aria-hidden="true">▦</span>チャート比較</Link>
    <Link to="/breadth"><span aria-hidden="true">▥</span>市場・業種</Link>
    <p className="feed-navigation-note">条件と根拠を確認する<br/>銘柄リサーチ</p>
  </nav>;
}

export default function ResearchFeedContext({ ranked, methodName, date, loading, children, onSector }) {
  const context = useMemo(() => researchFeedContext(ranked), [ranked]);
  return <aside className="research-feed-context" aria-label="市場と検索対象の内訳">
    <details className="feed-context-disclosure" open>
      <summary>市場とデータ <span>{date || '取得中'}</span></summary>
      <div className="feed-context-contents">
        {children}
        <section className="feed-context-card" aria-label="現在の検索対象">
          <h2>この表示の内訳 <small>{methodName}</small></h2>
          <dl><div><dt>対象銘柄</dt><dd>{loading ? '—' : context.total.toLocaleString()}</dd></div>
            <div><dt>全条件通過</dt><dd>{loading ? '—' : context.passed.toLocaleString()}</dd></div>
            <div><dt>未達がある</dt><dd>{loading ? '—' : context.failed.toLocaleString()}</dd></div>
            <div><dt>未達なし・未確認</dt><dd>{loading ? '—' : context.unknown.toLocaleString()}</dd></div></dl>
          <p>現在の絞り込み内の銘柄数です。日次の購入条件は別に確認します。</p>
        </section>
        <section className="feed-context-card feed-event-availability" aria-label="イベント比較の確認状況">
          <h2>日次イベント <span>比較未確認</span></h2>
          <p>互換性を確認した前後の記録がないため、現在の状態を表示しています。新規発生の件数は未確認です。</p>
          <p className="feed-context-caption">同じ日の再生成を「今日の変化」には数えません。</p>
        </section>
        <section className="feed-context-card" aria-label="業種別の選定内訳">
          <h2>業種別の選定 <small>通過 / 表示対象</small></h2>
          {context.groups.length ? <ul className="feed-sector-list">{context.groups.slice(0, 5).map(group => <li key={group.key}>
            <button aria-label={`${group.label}：通過 ${group.passed} / 対象 ${group.total}銘柄${group.total < 10 ? '・少数標本' : ''}。業種で絞り込む`} onClick={() => onSector(group.key)}><span>{group.label}{group.total < 10 && <small>少数標本</small>}</span><strong>{group.passed} / {group.total}</strong></button>
          </li>)}</ul> : <p>{loading ? '対象を確認中…' : '表示対象がありません'}</p>}
          <p>分類は配信データによります。業種の騰落率や強さの順位ではありません。</p>
          <Link to="/breadth?tab=sectors">市場全体の業種を見る →</Link>
        </section>
      </div>
    </details>
  </aside>;
}
