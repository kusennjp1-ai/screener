const warningDetail=plan=>`${plan.state==='買いゾーン内'?'アプリの範囲内ですが、':plan.state==='買いゾーン超過'?'アプリの買い上限と、':''}第1冊の約2〜3%目安を超えています。`;

// Reuse a header's existing text line so the caution is visible before scrolling.
export function EntrySourceBadge({plan}) {
 if(!plan?.sourceContext?.warning)return null;
 const label=`書籍の追随目安外：${warningDetail(plan)}`;
 return <span className="entry-source-badge" role="note" aria-label={label} title={label} style={{display:'inline-flex',flexShrink:0,color:'var(--wait)',fontSize:11,lineHeight:1.5,whiteSpace:'nowrap'}}>△ 書籍目安2〜3%超</span>;
}

export default function EntrySourceNote({plan, compact=false}) {
 const source=plan?.sourceContext;
 if(!source || (compact && !source.warning))return null;
 return <div className="entry-source-note" data-source-state={source.state} style={{fontSize:12,lineHeight:compact?1.5:1.65,marginTop:compact?4:8}}>
  {source.warning&&<p role="note" style={{color:'var(--wait)',margin:compact?0:'4px 0'}}>{compact?<><strong>△ 書籍の追随目安外</strong><span aria-hidden="true">（約2〜3%超）</span><span className="sr-only">：{warningDetail(plan)}</span></>:<><strong>△ 書籍の追随目安外</strong>：{warningDetail(plan)}</>}</p>}
  {!compact&&<details><summary style={{cursor:'pointer',minHeight:44,display:'flex',alignItems:'center'}}>アプリ設定と書籍の確認範囲</summary><p>{source.model} {source.detail}</p><p>書籍目安との比較は価格位置だけです。ベースの成立・売買の適否・全書籍条件の認定ではありません。</p></details>}
 </div>;
}
