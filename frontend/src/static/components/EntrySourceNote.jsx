export default function EntrySourceNote({plan, compact=false}) {
 const source=plan?.sourceContext;
 if(!source)return null;
 return <div className="entry-source-note" data-source-state={source.state} style={{fontSize:12,lineHeight:1.65,marginTop:8}}>
  {source.warning&&<p role="note" style={{color:'var(--wait)',margin:'4px 0'}}><strong>△ 書籍の追随目安外</strong>：アプリの範囲内でも、第1冊の約2〜3%目安を超えています。</p>}
  {!compact&&<details><summary style={{cursor:'pointer',minHeight:44,display:'flex',alignItems:'center'}}>アプリ設定と書籍の確認範囲</summary><p>{source.model} {source.detail}</p><p>書籍目安との比較は価格位置だけです。ベースの成立・売買の適否・全書籍条件の認定ではありません。</p></details>}
 </div>;
}
