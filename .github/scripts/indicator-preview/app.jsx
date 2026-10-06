import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MarketIndicatorHistories from '../src/static/components/MarketIndicatorHistories';
import ResearchDetail from '../src/static/components/ResearchDetail';
import CandidateBoard from '../src/static/components/CandidateBoard';
import { staticChartKeys } from '../src/static/chartClient';
import { assess } from '../src/static/researchEngine';
import { modelMarket } from '../src/static/portfolioPlan';
import { researchTheme, themeCss } from '../src/static/theme/tokens';
import '../src/static/research.css';
import '../src/static/theme/foundation.css';
import '../src/static/theme/motion.css';
import '../src/static/workbench.css';
import '../src/static/market.css';
import data from './preview-data.json';
import './preview.css';

const query = new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false,refetchOnMount:false}}});
for(const chart of data.charts) query.setQueryData([...staticChartKeys.payload(chart.symbol,`preview-${chart.symbol}.json`),'isolated-preview'],chart);
function App(){
 const [surface,setSurface]=useState('market'),[symbol,setSymbol]=useState('TSM'),[candidateView,setCandidateView]=useState('list');
 const row=data.rows.find(item=>item.symbol===symbol),market=modelMarket(data.rows);
 const ranked=data.rows.map(row=>({row,assessment:assess(row,'minervini',data.now)}));
 return <main className="research-workbench indicator-preview" data-theme="dark">
  <header className="preview-banner"><h1>指標履歴の確認用プレビュー</h1><p>公開・発注機能なし。実際のアプリのコンポーネントを、検証用の画面に配置しています。</p>{surface==='synthetic'?<p>合成ケースの基準日 {data.synthetic.as_of_date}。架空の価格・出来高・判定です。実データの履歴や財務値を混ぜていません。</p>:<><p>価格セッション {data.date} · 公開生成 {data.provenance.generated_at} · 銘柄詳細・接近集計のサンプル{data.rows.length}銘柄／新高値・新安値は公開チャート集合</p><p>財務の元観測 {data.provenance.financial_observations?.first.slice(0,10)||'未確認'}〜{data.provenance.financial_observations?.last.slice(0,10)||'未確認'}（UTC、表示サンプル）。評価時刻 {data.provenance.evaluated_at} は元観測の更新を意味しません。固定した公開入力だけを使い、未公開の更新は混ぜません。</p></>}<p className="preview-origin">{surface==='synthetic'?'合成テスト値：データ欠測・分配日失効・上抜け再計上の例。実市場の観測ではありません。':'実データ由来：既存の公開データをSHA-256で固定。新規の提供元取得なし。ベースと現位置はこのプレビューで再計算しています。'}</p></header>
  <nav aria-label="プレビュー対象" className="preview-nav"><button aria-pressed={surface==='market'} onClick={()=>setSurface('market')}>実データ：市場履歴</button><button aria-pressed={surface==='stock'} onClick={()=>setSurface('stock')}>実データ：銘柄履歴</button><button aria-pressed={surface==='synthetic'} onClick={()=>setSurface('synthetic')}>合成：境界条件</button></nav>
  {surface==='market'&&<div className="market-workbench"><MarketIndicatorHistories data={data.histories} expectedDate={data.date}/></div>}
  {surface==='synthetic'&&<div className="market-workbench"><MarketIndicatorHistories key="synthetic" data={data.synthetic} expectedDate={data.synthetic.as_of_date}/></div>}
  {surface==='stock'&&<><label className="preview-selector">実データの銘柄 <select aria-label="実データの銘柄" value={symbol} onChange={event=>setSymbol(event.target.value)}>{data.rows.map(item=><option key={item.symbol}>{item.symbol}</option>)}</select></label>
   <div className="research-grid"><CandidateBoard ranked={ranked} method="minervini" selectedSymbol={symbol} onSelect={setSymbol} date={data.date} now={data.now} market={market} view={candidateView} onView={setCandidateView}/>
   <ResearchDetail key={symbol} selected={row} method="minervini" date={data.date} now={data.now} market={market} chartEntry={{path:`preview-${symbol}.json`}} version="isolated-preview" onExpand={()=>{}} watch={[]} onWatch={()=>{}} liveStatus="検証用・日次のみ" personal={{}} onConnect={()=>{}} onDisconnect={()=>{}} onVerificationToggle={()=>{}} detail={{isSuccess:true}}/>
   </div>
  </>}
  <footer className="preview-banner"><p>入力識別子 {data.provenance.publication_sha256}</p><p>実データの接近・買い範囲はこの6銘柄だけの集計です。実データの新規上抜け履歴は未取得。合成例の件数と混ぜません。</p></footer>
 </main>;
}
document.documentElement.dataset.theme='dark';
createRoot(document.getElementById('root')).render(<ThemeProvider theme={createTheme(researchTheme('dark'))}><CssBaseline/><style>{themeCss}</style><div className="leader-shell" data-theme="dark"><QueryClientProvider client={query}><App/></QueryClientProvider></div></ThemeProvider>);
