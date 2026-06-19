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
