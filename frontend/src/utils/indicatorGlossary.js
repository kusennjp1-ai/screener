// Japanese glossary for the English indicator labels shown on the chart/scan
// screens. Each entry: the metric's meaning (jp) and how to read its values
// (how). Surfaced by tapping/long-pressing the label (see GlossaryLabel /
// the band legend). Keep entries short — they render inside a tooltip.

export const INDICATOR_GLOSSARY = {
  // --- Header badges / scores ---------------------------------------------
  grp_rank: {
    title: 'Grp Rank（業種グループ順位）',
    jp: 'IBD方式の業種グループ強さ順位（全197グループ中）。リーダーは強いグループに属する傾向。',
    how: '1〜40位＝最強グループ（妙味大）。〜98位で上位半分。数字が小さいほど良い。',
  },
  adr: {
    title: 'ADR（平均日中変動率）',
    jp: '1日の高値〜安値の平均変動率。ボラティリティ＝値動きの大きさの目安。',
    how: '高いほど一日の値幅が大きい。概ね4%以上＝高ボラ（利益も損失も速い）、2%未満＝低ボラ。',
  },
  eps_rating: {
    title: 'EPS Rating（EPSレーティング）',
    jp: '直近・年次のEPS成長を1〜99で相対評価。企業の収益力の強さ。',
    how: '80以上＝収益力上位（強い）。50未満＝弱い。高いほど良い。',
  },
  stage: {
    title: 'Stage（ステージ）',
    jp: 'ステージ分析。2＝上昇トレンド（買い対象）、1＝底固め、3＝天井、4＝下降。',
    how: 'Stage 2のみが買い対象。それ以外は様子見/回避。',
  },
  vcp: {
    title: 'VCP（収縮型ベース）',
    jp: 'Volatility Contraction Pattern。押し目が段階的に浅くなり出来高が枯れる、ブレイク前の理想的なベース。',
    how: '✓＝VCPベース形成中（低リスクのピボットが近い）。ピボット上抜けで買い。',
  },
  composite: {
    title: 'Composite（総合スコア）',
    jp: '複数スクリーナー（Minervini/CANSLIM等）を統合した総合点。',
    how: '高いほど総合的に有望。各スクリーナー個別スコアと併せて判断。',
  },
  minervini: {
    title: 'Minervini スコア',
    jp: 'Minerviniのトレンドテンプレート適合度。',
    how: '高いほどステージ2リーダーの条件を満たす。',
  },
  canslim: {
    title: 'CANSLIM スコア',
    jp: "William O'NeilのCANSLIM成長株条件の適合度。",
    how: '高いほどEPS/売上成長・新高値・主導株の条件を満たす。',
  },

  // --- Trend-template readout ---------------------------------------------
  rs_rating: {
    title: 'RS Rating（相対強度）',
    jp: '市場全体に対する株価の相対的な強さを1〜99で評価。主導株は高RS。',
    how: '90以上＝真のリーダー、70以上＝合格圏。70未満は弱い。高いほど良い。',
  },
  rs_line: {
    title: 'RS Line（相対強度ライン）',
    jp: '株価÷ベンチマーク。上昇＝市場をアウトパフォーム。先に新高値を取ると主導性の先行サイン。',
    how: '右肩上がりで価格より先に高値更新＝強い。青ドット＝RS新高値の主導サイン。',
  },
  ma_stack: {
    title: 'MA（移動平均の並び）',
    jp: 'トレンドテンプレートのMA整列：株価>50日>150日>200日、かつ200日が上向き。',
    how: '✓＝健全な上昇トレンドの並び。✗＝トレンド崩れ。',
  },
  week_52_low: {
    title: '52WL（52週安値からの距離）',
    jp: '52週安値からの上昇率。Minerviniは安値から十分離れた銘柄を好む。',
    how: '+30%以上が条件。大きいほど安値から離れて上昇している。',
  },
  week_52_high: {
    title: '52WH（52週高値からの距離）',
    jp: '52週高値からの距離（マイナス＝高値より下）。新高値近辺で買うのが基本。',
    how: '0%に近い（高値圏）ほど良い。-10%以内が買い妥当圏。',
  },
  pivot: {
    title: 'Pivot（ピボット）',
    jp: 'ベースの上抜けポイント＝買いトリガー価格。VCPの最終収縮の高値など。',
    how: '出来高を伴ってピボット上抜け＝買い。手前は様子見（Buy Ready）。',
  },

  // --- Buy-point annotations ----------------------------------------------
  buy_point: {
    title: 'Buy Point（買いポイント）',
    jp: 'ピボットを上抜けたブレイクアウト地点。',
    how: '出来高増加を伴う上抜けが理想。',
  },
  sepa_buy_point: {
    title: 'SEPA',
    jp: 'MinerviniのSEPA基準（ステージ2＋出来高）を満たす高品質なブレイク。',
    how: '最も信頼度の高い買いポイント。',
  },
  buy_ready: {
    title: 'Buy Ready（買い準備）',
    jp: 'ピボットの3%以内まで接近。ブレイク間近の準備段階。',
    how: 'ブレイクに備えて監視。まだ買いではない。',
  },
  buy_alert: {
    title: 'Buy Alert（警戒）',
    jp: 'ピボットの3〜8%下。ベース形成中で接近を警戒。',
    how: '監視リスト入りの目安。',
  },

  // --- Earnings line ------------------------------------------------------
  earnings_line: {
    title: '収益ライン（フェアバリュー線）',
    jp: 'TTM EPS×当該銘柄の中央値倍率で算出した妥当株価の線（緑）。',
    how: '株価が線より上＝割高、下＝割安。乖離が大きいほどその度合いが強い。',
  },

  // --- Markets 360 status-bar chips -----------------------------------------
  er: {
    title: 'ER（収益レーティング）',
    jp: 'EPS（1株利益）の成長力を0〜99で採点。四半期・年間の伸び率が高いほど高得点。',
    how: '80以上が理想。Minerviniは直近四半期EPS +25%以上を重視。',
  },
  sr: {
    title: 'SR（売上レーティング）',
    jp: '売上高の成長力を0〜99で採点。',
    how: 'ERとSRが両方高い銘柄は「本物の成長株」の可能性が高い。',
  },
  rpr: {
    title: 'RPR（相対パフォーマンス）',
    jp: '市場平均（SPY等）に対する相対的な強さを0〜99で採点。RS Ratingに相当。',
    how: '70以上が最低条件、80〜90以上が理想。市場より強い銘柄だけを買う。',
  },
  tpr: {
    title: 'TPR（トレンド適合度）',
    jp: 'トレンドテンプレート（株価>50日>150日>200日線、200日線上向き等）への適合度をA〜Eで評価。',
    how: 'A/Bのみ買い候補。C以下はステージ2の上昇トレンドにない。',
  },
  esr: {
    title: 'ESR（EPSサプライズ度）',
    jp: '決算がアナリスト予想をどれだけ上回ってきたかの採点。',
    how: '高いほど「決算で跳ねる」タイプ。決算跨ぎのリスク判断にも使う。',
  },
  vrr: {
    title: 'VRR（出来高変化率）',
    jp: '直近出来高が平常時と比べ何%増減しているか。機関投資家の足跡。',
    how: 'ブレイクアウト時は+50%以上の出来高増が理想（確証）。',
  },
  dist_20dma: {
    title: '+/−20dma（20日線乖離率）',
    jp: '株価が20日移動平均線から何%離れているか。',
    how: '+10%超は短期過熱（追撃買いは危険）。押し目はこの線への回帰を待つ。',
  },
  monalert: {
    title: 'MonAlert（モメンタム警戒ネット）',
    jp: '直近の強気シグナル数 − 弱気シグナル数。プラスが大きいほど需給良好。',
    how: '5以上＝強い需給。0以下＝警戒。悪化の初動は売り準備のサイン。',
  },
  pressure: {
    title: 'Pressure（買い圧力バンド）',
    jp: '3本カラーバンドの1本目。機関投資家の累積的な買い集め/売り抜けを検出。',
    how: 'BUY（緑）＝買い集め進行中。SELL（赤）＝売り抜け。緑の期間のみ新規買い。',
  },
  buy_risk: {
    title: 'Buy Risk（買いリスクバンド）',
    jp: '3本カラーバンドの2本目。今この価格で買った場合のリスク量（ATRベースの過熱度）。',
    how: 'LOW（緑）＝買って良い位置。HIGH（赤）＝過熱、新規買いは不利。',
  },

  // --- Buy / sell plan cards -------------------------------------------------
  entry: {
    title: 'Entry（エントリー価格）',
    jp: 'ピボット（ベース上限）をブレイクした瞬間の買い価格。',
    how: 'ピボットから+5%以上は追いかけない。"Buy right, sit tight."',
  },
  stop: {
    title: 'Stop（損切りライン）',
    jp: 'ここを下回ったら機械的に売る価格。ベース安値直下か最大−8%の近い方。',
    how: '例外なく守る。「損は小さく、利は大きく」の生命線。',
  },
  r_multiple: {
    title: 'R倍数（Reward:Risk）',
    jp: '許容リスク（R＝買値−損切り）の何倍の含み益が出ているか。',
    how: '2Rで損切りを建値へ、3Rで利益確定を検討するのが目安。',
  },
  position_size: {
    title: 'Size（ポジションサイズ）',
    jp: '損切りになっても口座の約1.25%しか失わないよう逆算した資金投入割合。',
    how: 'ストップ幅が広いほど投入額を減らす。「ストップがサイズを決める」。',
  },
  trailing_stop: {
    title: 'Trailing Stop（追随損切り）',
    jp: '含み益の増加に応じて損切りラインを切り上げる仕組み。下げることは絶対にない。',
    how: '1Rでリスク半減、2Rで建値、3R以降は50日線/直近安値に追随。',
  },
  climax: {
    title: 'Climax Run（クライマックス・ラン）',
    jp: '長期上昇の最終局面で起こるパラボリックな急騰。天井のサイン。',
    how: '10日中8日上昇・最大の上げ幅が終盤・窓開け急騰が重なったら「強さに売る」。',
  },
  breakdown_50dma: {
    title: '50-DMA Breakdown（50日線割れ）',
    jp: '出来高を伴って50日移動平均線を終値で割り込むトレンド崩壊シグナル。',
    how: 'Minerviniの代表的な売りシグナル。成熟したポジションなら手仕舞い。',
  },

  // --- Market regime banner ----------------------------------------------------
  market_regime: {
    title: 'Market（市場レジーム）',
    jp: '市場全体の状態判定。Confirmed Uptrend＝上昇確認、Correction＝調整中など。',
    how: '調整中は新規買いを絞る。個別が良くても市場が悪ければ勝率は落ちる。',
  },
  market_health: {
    title: 'Health（市場ヘルス 0〜100）',
    jp: '主要指数のトレンド・騰落状況・分配日数を統合した市場の健康度。',
    how: '70以上＝健全。50割れ＝守り優先。',
  },
  exposure: {
    title: 'Exposure（推奨投入率）',
    jp: '市場環境に応じて資金の何%まで株式に投じてよいかの目安。',
    how: '市場悪化ほど下がる。100%＝フルインベスト、20%＝試し玉のみ。',
  },
  distribution_days: {
    title: 'Distribution Days（分配日）',
    jp: '主要指数が出来高増を伴い下落した日数（直近25営業日）。機関の売り抜けの痕跡。+5%上昇したものは失効。',
    how: '4〜5日以上溜まると上昇相場が崩れやすい（O\'Neilの天井判定）。',
  },
  follow_through: {
    title: 'FTD（フォロースルーデイ）',
    jp: '調整の底を確認するO\'Neilのシグナル。安値からのラリー4日目以降に、指数が出来高増を伴い+1.2%以上上昇した日。移動平均の回復より数週間早く「買い再開」を告げる。',
    how: 'FTD直後は試し玉25%→1週間生き残れば50%→3週間クリーンなら75%と段階的に投入（progressive exposure）。FTD日の安値割れで失効。',
  },
};

// Resolve an execution-state key to a glossary-style explanation.
export const EXECUTION_STATE_GLOSSARY = {
  pre_breakout: {
    title: 'Pre-breakout（ブレイク前）',
    jp: 'ベースを形成し、ピボット上抜け（ブレイク）を待つ低リスクの仕掛け前段階。',
    how: '出来高を伴うピボット上抜けで買い。最も妙味のある状態のひとつ。',
  },
  breakout: {
    title: 'Breakout（ブレイク中）',
    jp: 'ピボットを上抜けた直後。仕掛けの実行局面。',
    how: '出来高増加を確認。伸び過ぎる前のタイミング。',
  },
  early_post_breakout: {
    title: 'Early post（ブレイク直後）',
    jp: 'ブレイク後まだ日が浅い段階。',
    how: '押し目（5日線等）からの追随買いの余地。',
  },
  extended: {
    title: 'Extended（伸び過ぎ）',
    jp: '買い場（ピボット）から離れて上昇し過ぎた状態。',
    how: '新規買いは不利（リスク高）。押し目を待つ。',
  },
  overextended: {
    title: 'Overextended（過伸長）',
    jp: '極端に伸び過ぎ。反落リスクが高い。',
    how: '新規買い回避。利確/トレーリングの検討局面。',
  },
  damaged: {
    title: 'Damaged（トレンド毀損）',
    jp: 'ベースやトレンドが崩れた状態。',
    how: '買い対象外。回復を待つ。',
  },
  invalid: {
    title: 'Invalid（無効）',
    jp: '条件を満たさずセットアップとして無効。',
    how: '対象外。',
  },
};
