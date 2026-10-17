# STATE — オニール原典との比較診断（ローカル）

更新2026-10-13。基点 `327b7a69e61a614f0579320cef1de7ac221f5f0d` を保持し、branch `private/oneil-source-diagnostics-20261013` で追加。同じ選択環境へ復旧して作業を保存し、別環境移行・制限迂回なし。

## 変更と境界

- 銘柄詳細の財務タブに診断専用の比較欄を追加。原典PDF197頁の3年EPS CAGR25%以上＋各年増益と、現行各年EPS25%以上を並列表示。PDF66頁の最新売上YoY25%以上OR直近3期加速も現行条件と分離する。親の原本確認済み要旨を使用し、この環境ではPDFを取得していない。
- 年次は既存common validatorで確認できる4期の正の報告EPSだけを使用。CAGRは既存decimal/BigInt方針で厳密比較し、欠損・非正・重複・不明単位は未確認。既存72時間/550日期限を再使用し、この欄だけ期限到達時に更新。
- 売上最新枝は共通検証済みの正規2桁YoYのみ。25より大きい値は該当、小さい値は未達、25.00%は丸め前が不明なので未確認。3期加速のadmitted系列は不足し、本番枝は未確認のまま。5→10→20等のpure数学テストは合成のみで、実系列のadmissionと混同しない。
- 三値ORは一枝passならpass、両failだけfail、他unknown。scalar/raw履歴から救済しない。診断結果を既存選定・順位・CSV・entryへ書き戻さない。
- 財務capture/admission、既存金融validator/ルール、固定exporter、publisher pin、認証、公開条件は無変更。以前の327bと市場履歴成果物を保持。

## 検証

- 最終全Vitest244 files/3429成功（226.39秒）、core122、UI64、独立全出力比較9556、欠損/境界/期間等940、backend275、Golden43成功。core/UI等の件数は全体と重複。
- 独立比較は226合成fixture×4方式、CSV全bytes・説明も含めて除外なし。28依存と保護1975filesのbyte不変。最小再現copyでも9556＋940成功。
- lint0errors/既存6warnings、build成功/既存chunk警告。browser4成功、375/1440px明暗・合成のみ・外部遮断、32画像（UI担当4枚/root2枚目視）。
- 初期の疎配列test lint、invalid clockのUI救済、期限到達更新を修正。既存fund testの広いDOMcountは元7行へ限定し、全欄のpass/failなしassertは保持。旧中断runの同一log書込み混在を分離し、最終全suiteは専用logで再実行。

## 残件と成果物

- 本番3期加速の契約接続は未実装。実 `frontend/public/static-data` 不在で実配信系列/本番Design/CIは未検証。Node24/Python3.12はCI版と異なる。IBD全通過/配分ありportfolioは既存admissionのまま未到達。
- 原典の2条件だけの診断で、全冊・全規則の再現や売買推奨ではない。株式単位/分割/ADRは提供元報告に依存し、分析日当時の公表証明ではない。
- 証跡 `/workspace/oneil-source-diagnostics-20261013/`。差分・ログ・合成画像・可搬再現copyを新しいLibrary項目へ保存。以前のLibrary成果物は置換しない。
- bd未導入。明示のpush禁止をcheckout/skillの通常手順より優先。push/PR/merge/Actions/公開/provider取得/認証変更なし。市場履歴の不足5指標producer等は従前どおり。
