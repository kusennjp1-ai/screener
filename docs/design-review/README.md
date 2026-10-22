# デザイン検証の証跡

`Design Acceptance` ワークフローは公開済みの実データを一度復元し、変更前・変更後を同じ入力からビルドする。日付は書き換えない。1440×900 / 390×844 × ダーク / ライトで画面を撮影し、axeの4タグ、操作対象、文字・角丸の段階、横スクロール、reduced-motion、画面別の配置予算を記録する。結果は失敗時も `design-acceptance-<commit>` 成果物に残る。

CPU4倍はCDPで指定し、ウォームアップ時の応答をメモリから返す。各幅で3回測る。Q1のCI許容値（4.2秒 / 480ms）とP1の合格値（3.5秒 / 400ms / 最長200ms）を区別し、P1を満たさない場合も失敗として残す。メモリ値は同じブラウザ条件での参考観測であり、GCの影響がある。

画面を実際に確認した後、日付付きMarkdownに4項目の点数と理由を記録する。同じ内容を日付付きJSONにも保存する。形式:

```json
{
  "observed_commit": "撮影したソースの40桁コミット",
  "reviewer": "レビュー担当と、内部評価であること",
  "evidence_run": "GitHub Actions実行のURL",
  "screens": [{
    "key": "home/1440/dark",
    "screenshot": "home-1440x900-dark.png",
    "scores": {
      "design": {"value": 0, "reason": "画像を見てから採点する"},
      "usability": {"value": 0, "reason": "同上"},
      "originality": {"value": 0, "reason": "同上"},
      "content": {"value": 0, "reason": "同上"}
    }
  }]
}
```

上の0点は形式例であり合格記録ではない。採点前の8点入力、未撮影の画面の採点、客観検査の失敗を点数で相殺することはしない。`check-design-review.mjs` は原則として4項目すべて8.0以上、全撮影条件の記録、および採点後にUIコードが変わっていないことを検証する。UIが変われば再撮影・再採点が必要。

各タスクの証跡には、共有部品・依存タスクを含む最終画面を確認したことを明記する。タスク単独の旧状態を撮影していない場合は、そのように記す。

## スクリーニング優先の限定的な画像レビュー

2026-10-22 の公開更新と、スクリーニングに直接関係しない要素を後回しにする依頼に対応する。点数を引き上げたり、全軸の基準を一括して下げたりしない。従来の厳格判定と元の点数・理由をそのまま保持する。

`review_policy: "ordinary-carry-image-review-2026-10-22-v1"` を明示したレビューだけが対象となる。既存の `ordinary-carry-screening-priority-2026-10-21-v1` に結び付いた通常・財務引継ぎ比較に限り、認証済み入力、完了記録、画像の実バイト、操作・アクセシビリティ・CSV・財務 unknown の客観検査をすべて先に検証する。候補財務訂正、限定プレビュー、未結合の測定には適用しない。新しいデータ・財務認可・公開権限は付与しない。

全 134 画面（通常）または 162 画面（財務引継ぎ）について、従来の4点数・理由に加え、実画像と一致する `sha256`、次の `visualChecks`、および `findings` 配列が必要。レビュー対象のコミット、実行URL、担当者も必須。

- `text_and_labels`: 撮影範囲の必須文字・ラベルの判読性。
- `clipping_and_occlusion`: 必須内容の欠け、重なり、隠れ。
- `visible_navigation_affordances`: 撮影された操作手掛かりの見え方。
- `visible_content_consistency`: 撮影範囲内の表示内容・ラベル間の整合性。

各項目は `{ "status": "pass" | "fail" | "unknown", "reason": "画像を確認した具体的な理由" }`。画像から実際の遷移、アクセシビリティ計測、財務情報の正しさを推定しない。それらは既存の別検査で確認する。画面外の未撮影事項を新たな画像検査項目にしない。

各 finding は `axis`（design/usability/originality/content）、`category`、`screeningImpact`、具体的な `reason` の4項目を持つ。8点未満の各軸には最低1件の対応 finding が必要。高得点でも実害のある finding を省略しない。

- category: `cosmetic` / `originality` / `readability` / `clipping` / `navigation` / `incorrect_content` / `accessibility` / `other`。
- screeningImpact: `non_screening_aesthetic` / `screening_material` / `unknown`。
- `cosmetic` または `originality` かつ `non_screening_aesthetic` と具体的に確認できた finding だけを、明記した保留警告にできる。
- 判読性、欠け・重なり、操作手掛かり、内容不整合等の実害は停止条件。数値が8以上でも停止する。分類欠落、曖昧・不明な分類、unknown の影響、必須 visualCheck の fail/unknown は停止する。

結果は `test-results/design-review/screening-priority-image-assessment.json` に別記録として保存する。元の全点数・理由、`strict_image_result`、`strict_result`、警告と停止理由を残す。保留を認めても「全項目8点以上」や厳格基準合格とは表示しない。レビュー自体は金融データの更新認可ではなく、期限切れ・未確認の必須条件を適格に変えない。

画像ハッシュの一致条件は緩めない。レビューだけのコミットでも、再撮影した時刻表示や入力が変われば旧画像の採点は使えない。この分類ポリシーは過去の撮影成果物を新しい実行で再利用する仕組みを追加していない。
