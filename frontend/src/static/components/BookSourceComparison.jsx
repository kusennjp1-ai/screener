import { BOOK_SOURCES } from '../bookSourceContext';
import { bookRuleComparisons } from '../bookRuleComparisons';
import './bookSourceComparison.css';

const strengths = { required:'原典の必須条件', preference:'好ましい特徴', exception:'限定された例外', personal_minimum:'著者個人の最低目安', discretionary:'裁量・固定閾値なし', alternative:'選択肢のある条件', app_policy:'アプリの制約' };
const states = { pass:'この比較は充足', fail:'この比較は未充足', unknown:'未確認', review:'個別確認', not_applicable:'対象外' };
function RuleCard({ card }) {
  return <li className="book-source-rule" data-rule-id={card.id} data-rule-state={card.state}>
    <div className="book-source-rule-head"><strong>{card.title}</strong><span className={`book-comparison-state state-${card.state}`}>{states[card.state]}</span></div>
    <p className="book-source-meta">{strengths[card.strength]} · {card.author}{card.scope==='application_window_comparison'?' · アプリ窓での参考比較':''}</p>
    <p>{card.explanation}</p>
    {card.evidence&&<p className="book-source-evidence">{card.evidence}</p>}
    {card.strictThresholdState&&<p>アプリ閾値との比較（同じ4期で毎年25%以上）：{states[card.strictThresholdState]}</p>}
    {card.citation&&<p className="book-source-citation">出典：{card.citation}</p>}
  </li>;
}

export default function BookSourceComparison({ row, date, now, method }) {
  const result = bookRuleComparisons(row, { date, now, method });
  return <section className="book-source-comparison" aria-label="4冊の条件と現行判定">
    <h3>4冊の条件と現行判定</h3>
    <p>{result.symbol} · 日次基準日 {date || '未確認'}。{result.technical.reason}。</p>
    <p className="book-source-policy">{result.policy}</p>
    {BOOK_SOURCES.map(book=><details key={`${result.symbol}-${result.method}-${book.id}`} className="book-source-book" open={result.activeBookId===book.id||undefined}>
      <summary>{book.title}<span>{result.activeBookId===book.id?'選択中の方式に対応':'出典を比較'}</span></summary>
      <p className="book-source-meta">{book.englishTitle} · {book.author}</p>
      <ul>{result.cards.filter(card=>card.bookId===book.id).map(card=><RuleCard key={card.id} card={card}/>)}</ul>
    </details>)}
    <details className="book-source-book"><summary>アプリ独自の制約<span>書籍の比較と区別</span></summary><ul>{result.cards.filter(card=>!card.bookId).map(card=><RuleCard key={card.id} card={card}/>)}</ul></details>
    <p className="book-source-meta">{result.citationNote}</p>
  </section>;
}
