// 指標解説辞書（メトリック・グロッサリー）
// 画面上の指標ラベルをクリックしたときに表示する日本語の解説。
// id はテーブル列 id やページ固有のメトリックキーに対応する。
// title=指標名 / meaning=意味 / reading=見方（任意）

const GLOSSARY = {
  symbol: {
    title: '銘柄コード（ティッカー）',
    meaning: '米国市場で銘柄を識別する英字コードです。例: AAPL = Apple。',
    reading: 'クリック（行クリック）でチャートや詳細を確認できます。',
  },
  rs_trend: {
    title: 'RSトレンド（30日）',
    meaning: 'RSライン（銘柄の株価 ÷ 市場平均）の直近30日間の推移をミニチャートで表示します。市場平均に対する相対的な強さの方向が分かります。',
    reading: '右肩上がりなら市場をアウトパフォーム中。株価より先にRSラインが新高値を付ける銘柄は特に強いとされます。',
  },
  price_change_1d: {
    title: '株価（前日比）',
    meaning: '直近終値と前日終値からの変化率です。',
    reading: '緑（プラス）は上昇、赤（マイナス）は下落を示します。',
  },
  gics_sector: {
    title: 'セクター（GICS）',
    meaning: '世界産業分類基準（GICS）に基づく大分類セクターです。例: Information Technology、Health Care。',
  },
  ibd_industry_group: {
    title: 'IBD業種グループ',
    meaning: 'IBD（Investor’s Business Daily）方式の197業種グループ分類です。セクターよりも細かい産業区分で、資金がどの産業に向かっているかを掴むのに使います。',
    reading: '上位グループ（順位の数字が小さい）に属する銘柄ほど追い風を受けやすいとされます。',
  },
  market_themes: {
    title: 'テーマ',
    meaning: 'その銘柄が関連する市場テーマ（AI、半導体など）です。',
  },
  ibd_group_rank: {
    title: 'グループ順位',
    meaning: '所属するIBD業種グループの相対強度ランキング（1〜197位）です。1位が最強です。',
    reading: '40位以内が「主導グループ」の目安。オニール流では上位グループの主導銘柄を狙います。',
  },
  composite_score: {
    title: '総合スコア（Composite）',
    meaning: '複数のスクリーニング手法（ミネルヴィニ、CANSLIM、IPO、出来高ブレイクスルー等）のスコアを統合した0〜100の総合評価です。',
    reading: '高いほど複数の手法で同時に高評価。並べ替えの既定値です。',
  },
  minervini_score: {
    title: 'ミネルヴィニスコア（Min）',
    meaning: 'マーク・ミネルヴィニのトレンドテンプレート（株価が50日>150日>200日移動平均の上、52週安値から30%以上上、RS高位など）への適合度スコアです。',
    reading: '高いほど「ステージ2の上昇トレンド」条件を満たしています。',
  },
  canslim_score: {
    title: 'CANSLIMスコア（CAN）',
    meaning: 'ウィリアム・オニールのCANSLIM基準（四半期EPS成長25%超、年間EPS成長、新高値、機関投資家の保有など）への適合度スコアです。',
    reading: '高いほどファンダメンタルズ＋テクニカル両面でオニール基準を満たしています。',
  },
  ipo_score: {
    title: 'IPOスコア',
    meaning: '新規上場（IPO）銘柄向けの評価スコアです。上場後の値動きやベース形成を評価します。',
  },
  custom_score: {
    title: 'カスタムスコア（Cust）',
    meaning: 'ユーザー定義のカスタムスクリーナーによるスコアです。',
  },
  volume_breakthrough_score: {
    title: '出来高ブレイクスルースコア（VolB）',
    meaning: '過去の平均と比べて異常な大商いを伴う上昇（機関投資家の買いの痕跡）を検出するスコアです。',
    reading: '高いほど直近で出来高を伴う強い買いが入っています。',
  },
  se_setup_score: {
    title: 'セットアップスコア（SE）',
    meaning: 'セットアップエンジンによる「買い場の形（ベース／ピボット）」の総合評価です。',
    reading: '高いほどブレイクアウト候補として形が整っています。',
  },
  se_pattern_primary: {
    title: 'パターン（Pat）',
    meaning: '検出された主要なチャートパターンです。例: VCP（ボラティリティ収縮）、フラットベース、カップウィズハンドル。',
  },
  se_distance_to_pivot_pct: {
    title: 'ピボットまでの距離（Pvt%）',
    meaning: '現在値からブレイクアウト基準価格（ピボット）までの乖離率です。',
    reading: '0%に近いほどブレイクアウト直前。マイナスはすでにピボット超え。',
  },
  se_bb_width_pctile_252: {
    title: 'スクイーズ（Sqz）',
    meaning: 'ボリンジャーバンド幅の過去252日内パーセンタイルです。値が小さいほどボラティリティが収縮（スクイーズ）しています。',
    reading: '収縮の後には大きな値動きが出やすいとされます。',
  },
  se_volume_vs_50d: {
    title: '出来高/50日平均（V50）',
    meaning: '当日出来高の50日平均出来高に対する倍率です。',
    reading: 'ブレイクアウト時は1.5倍以上の出来高増が望ましいとされます。',
  },
  se_rs_line_new_high: {
    title: 'RSライン新高値（RSH）',
    meaning: 'RSライン（対市場相対力）が新高値を付けているかを示します。',
    reading: '株価の新高値より先にRSラインが新高値を付けると、特に強いシグナルです。',
  },
  se_rs_line_blue_dot: {
    title: 'ブルードット（BD）',
    meaning: 'ベース形成中にRSラインが新高値を付けた状態（MarketSmithの青丸表示に相当）です。',
    reading: 'ブレイクアウト前の先行指標として注目されます。',
  },
  se_pivot_price: {
    title: 'ピボット価格（Pvt$）',
    meaning: 'ベースの抵抗線にあたる、ブレイクアウトの基準価格です。',
    reading: 'この価格を出来高を伴って上抜けたときが教科書的な買いポイントです。',
  },
  rs_rating: {
    title: 'RSレーティング',
    meaning: '過去1年の株価パフォーマンスを全銘柄と比較した相対強度の順位（1〜99）です。99が最強です。',
    reading: 'ミネルヴィニは70以上（理想は80〜90以上）を推奨。市場の主導株はブレイク前からRSが高い傾向があります。',
  },
  rs_rating_1m: {
    title: 'RSレーティング（1ヶ月）',
    meaning: '直近1ヶ月のパフォーマンスに基づくRSレーティングです。短期の勢いを示します。',
  },
  rs_rating_3m: {
    title: 'RSレーティング（3ヶ月）',
    meaning: '直近3ヶ月のパフォーマンスに基づくRSレーティングです。',
  },
  rs_rating_12m: {
    title: 'RSレーティング（12ヶ月）',
    meaning: '直近12ヶ月のパフォーマンスに基づくRSレーティングです。',
  },
  beta: {
    title: 'β（ベータ）',
    meaning: '市場全体に対する株価の感応度です。1より大きいほど市場より値動きが大きいことを意味します。',
  },
  beta_adj_rs: {
    title: 'β調整RS（βRS）',
    meaning: 'ベータ（値動きの大きさ）の影響を取り除いて算出した相対強度です。単に値動きが荒いだけの銘柄を除き、質の高い強さを評価します。',
  },
  eps_rating: {
    title: 'EPSレーティング',
    meaning: '1株当たり利益（EPS）の成長力を全銘柄と比較した順位（1〜99）です。99が最強です。',
    reading: 'CANSLIMでは80以上が目安とされます。',
  },
  stage: {
    title: 'ステージ（Stg）',
    meaning: 'ワインスタインのステージ分析による現在の局面です。1=底固め、2=上昇、3=天井圏、4=下落。',
    reading: '買い候補は原則「ステージ2（上昇トレンド）」の銘柄に絞ります。',
  },
  current_price: {
    title: '株価',
    meaning: '直近終値です。',
  },
  volume: {
    title: '売買代金（$Vol）',
    meaning: '直近の売買代金（株価×出来高）です。流動性の指標になります。',
    reading: '大きいほど売買しやすく、機関投資家も参加しやすい銘柄です。',
  },
  market_cap: {
    title: '時価総額（MCap）',
    meaning: '株価×発行済株式数。企業の規模を表します。',
  },
  adv_usd: {
    title: '平均売買代金（ADV）',
    meaning: '一定期間の1日あたり平均売買代金（米ドル）です。',
  },
  ipo_date: {
    title: 'IPO日',
    meaning: '新規上場した日付です。上場から数年以内の「若い銘柄」から大化け株が出やすいとされます。',
  },
  eps_growth_qq: {
    title: 'EPS成長率',
    meaning: '直近四半期のEPS（1株当たり利益）の前年同期比成長率です。',
    reading: 'CANSLIMの「C」。25%以上が目安です。',
  },
  sales_growth_qq: {
    title: '売上成長率（Sales）',
    meaning: '直近四半期の売上高の前年同期比成長率です。',
    reading: '20〜25%以上が望ましいとされます。利益と売上が両方伸びている銘柄が理想です。',
  },
  adr_percent: {
    title: 'ADR（平均日次レンジ）',
    meaning: '1日の値幅（高値と安値の差）の平均を%で表したものです。値動きの大きさ＝ボラティリティの指標です。',
    reading: '短期トレードでは3〜5%程度が扱いやすいとされます。大きすぎるとリスク管理が難しくなります。',
  },
  ma_alignment: {
    title: '移動平均の整列（MA）',
    meaning: '株価 > 50日 > 150日 > 200日移動平均という強気の並び（パーフェクトオーダー）になっているかを示します。',
    reading: '✓はミネルヴィニのトレンドテンプレートの中核条件を満たしている状態です。',
  },
  vcp_detected: {
    title: 'VCP検出',
    meaning: 'VCP（Volatility Contraction Pattern＝ボラティリティ収縮パターン）が検出されたかを示します。ミネルヴィニが提唱する、価格の振れ幅が段階的に小さくなるベース形成パターンです。',
    reading: '収縮が進みピボット付近で出来高が枯れた後のブレイクアウトが買いポイントです。',
  },
  vcp_score: {
    title: 'VCPスコア（VScr）',
    meaning: 'VCPパターンの質（収縮回数、深さ、出来高の枯れ方など）を点数化したものです。',
  },
  vcp_pivot: {
    title: 'VCPピボット（Pvt）',
    meaning: 'VCPパターンから算出したブレイクアウト基準価格です。',
  },
  vcp_ready_for_breakout: {
    title: 'ブレイク準備（Rdy）',
    meaning: 'VCPの収縮が完了し、ブレイクアウト直前の状態にあるかを示します。',
  },
  passes_template: {
    title: 'テンプレート合格（Pass）',
    meaning: 'ミネルヴィニのトレンドテンプレート8条件をすべて満たしているかを示します。',
  },
  rating: {
    title: '総合評価（Rate）',
    meaning: 'スコアやテンプレート適合状況をまとめた段階評価です。',
  },
  // --- デイリーページ ---
  daily_score: {
    title: 'スコア',
    meaning: '総合スコア（Composite）です。複数のスクリーニング手法の評価を統合した0〜100の値です。',
    reading: '高い順に並んでいます。',
  },
  price_trend_30d: {
    title: '株価トレンド（30日）',
    meaning: '直近30日間の株価推移のミニチャートです。',
  },
  rs_trend_30d: {
    title: 'RSトレンド（30日）',
    meaning: '直近30日間のRSライン（対市場相対力）推移のミニチャートです。',
    reading: '株価とともにRSラインも右肩上がりの銘柄が理想です。',
  },
  // --- 騰落（ブレッドス）ページ ---
  stocks_up_4pct: {
    title: '4%以上 上昇銘柄数',
    meaning: 'その日、出来高を伴って4%以上上昇した銘柄の数です（StockBee方式のブレッドス指標）。',
    reading: '上昇銘柄数が下落銘柄数を大きく上回る日が続くと、市場全体が強気と判断できます。',
  },
  stocks_down_4pct: {
    title: '4%以上 下落銘柄数',
    meaning: 'その日、4%以上下落した銘柄の数です。',
    reading: '下落銘柄数が継続的に多い場合は市場が弱く、新規買いを控える局面です。',
  },
  ratio_5day: {
    title: '5日レシオ',
    meaning: '過去5日間の「4%以上上昇銘柄数 ÷ 4%以上下落銘柄数」の比率です。',
    reading: '1超で買い優勢。2以上は強い上昇相場、0.5以下は弱い相場の目安です。',
  },
  ratio_10day: {
    title: '10日レシオ',
    meaning: '過去10日間の「4%以上上昇銘柄数 ÷ 4%以上下落銘柄数」の比率です。5日レシオより滑らかで、中期的な地合いを示します。',
    reading: '1超で買い優勢。トレンド転換の確認に使います。',
  },
  // --- 業種グループページ ---
  group_rank: {
    title: 'グループ順位',
    meaning: '197のIBD業種グループを相対強度で順位付けしたものです。1位が最強です。',
    reading: '上位40位以内のグループに資金が集まっていると考えられます。',
  },
  group_avg_rs: {
    title: '平均RS',
    meaning: 'グループ構成銘柄のRSレーティングの平均値です。',
    reading: '高いほどグループ全体が市場をアウトパフォームしています。',
  },
  group_num_stocks: {
    title: '銘柄数',
    meaning: 'そのグループに属する銘柄の数です。',
  },
  group_rank_change: {
    title: '順位変化',
    meaning: '一定期間（1週/1ヶ月/3ヶ月/6ヶ月）でのグループ順位の変化です。プラス（緑）は順位上昇＝資金流入を示します。',
    reading: '順位が急上昇しているグループは新しい主導セクター候補です。',
  },
  group_top_stock: {
    title: '代表銘柄',
    meaning: 'そのグループ内で最も評価の高い銘柄です。',
    reading: '主導グループの主導銘柄（リーダー株）が最有力の買い候補とされます。',
  },
};

// 別キーから同じ解説を引くためのエイリアス
const ALIASES = {
  daily_symbol: 'symbol',
  daily_price: 'current_price',
  daily_mcap: 'market_cap',
  daily_rating: 'rating',
  daily_rs: 'rs_rating',
  daily_ibd_group: 'ibd_industry_group',
  daily_group_rank: 'ibd_group_rank',
  group_rank_change_1w: 'group_rank_change',
  group_rank_change_1m: 'group_rank_change',
  group_rank_change_3m: 'group_rank_change',
  group_rank_change_6m: 'group_rank_change',
};

export function getGlossaryEntry(id) {
  if (!id) return null;
  return GLOSSARY[id] || GLOSSARY[ALIASES[id]] || null;
}

export function hasGlossaryEntry(id) {
  return Boolean(getGlossaryEntry(id));
}

export default GLOSSARY;
