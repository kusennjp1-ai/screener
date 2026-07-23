# TradingView の「CDP操作」をこの環境でどう活かすか

tradingview-mcp（https://github.com/tradesdontlie/tradingview-mcp）が使っている核心は
**「Chromium/Electron 製アプリは Chrome DevTools Protocol(CDP) で外から中身を読める／操作できる」**
という点です。TradingView Desktop は Electron 製なので、公式APIが無くても CDP 経由で
チャートの中身（銘柄・OHLCV・インジケーター値・描画・板・スクショ）を取れる、というわけです。

私たちのスクリーナーは Web アプリで、**Playwright が同じ CDP クライアント**、Chromium も
同梱済み（`/opt/pw-browsers/chromium`）。なので **同じ技術を "自分たちのアプリ" に向ければ、
この環境でそのまま実行できます**（localhost は遮断されていない）。

## この環境でできること／ユーザーのPC側でやること

| tradingview-mcp の機能 | 私たちの等価物 | この環境で実行 |
|---|---|---|
| チャート状態（銘柄/足/OHLCV）を読む | 静的JSON payload＋DOMから読める | ○ |
| インジケーター値（MA/RS/バンド/テンプレ）を読む | 自前のPythonエンジンが計算済み＋DOMに表示 | ○ |
| 描画（線/ラベル/箱）を読む | ピボット/ストップ/2R-3R/買いゾーンの"数値"をDOMから読む | ○（キャンバスのピクセルではなく数値を読む） |
| スクリーンショット | Playwright/CDPでPWAを撮影 | ○ |
| ストラテジーテスター結果 | 908トレードの検証ハーネス（オフライン再生） | ○ |
| 板情報（Level-2） | 該当データ源が無い（日足OHLCVのみ） | ×（そもそも対象外） |
| Pine Script開発ループ（書く→注入→コンパイル→修正） | Pineコンパイラが無い→**自前Python検出器→908ハーネス→修正**のループが等価 | Pine自体は×／等価ループは○ |
| プランをTradingViewに描画 | Pineオーバーレイ生成＋deep-link（C89）は生成済み、描画は本人のTVで | 生成○／描画は本人PC |

**結論**: 8機能中6つはこの環境で実現可能。板情報だけは対象外（データが無い）、Pineの実コンパイルだけは本人のPC側。

## この環境で作ったもの（C94）

`frontend/tools/chart-inspector/`（詳細は同ディレクトリの README）。
記事と同じ CDP セッション（`Runtime.evaluate`＋`Page.captureScreenshot`）で、
私たちのスクリーナーが**画面に出した売買プランを読み取り、内部矛盾を検査**します：

- ラダーのストップ＝フッターのストップか
- 2R＝pivot＋2×(pivot−stop)、3R＝pivot＋3×(pivot−stop) になっているか
- 表示の「risk −X%」＝(pivot−stop)/pivot になっているか

矛盾があれば**非ゼロ終了**するので CI ゲートにできます。凍結メトリクス（FIRE±5/GATE/golden）には
一切触れない、純粋な「表示の正しさ」ゲートです。実データ相当のフィクスチャで、正しいプランは通過・
わざとズラしたプランは検出することを確認済み。

```bash
node tools/chart-inspector/inspect.mjs http://localhost:5173/ --out ./inspect
```

## tradingview-mcp 本体を"自分のPC"で動かす手順（本物のTV操作をしたい場合）

この環境からは TradingView も動画サイトも遮断されているので、**TVそのものの操作は自分のPCで**行います：

1. TradingView **Desktop**（Electron版）をインストールし、デバッグポート付きで起動
   （例: `--remote-debugging-port=9222`。有料プランだとリアルタイム値まで取れる）。
2. 自分のPCの Claude Code / Cursor / Codex に tradingview-mcp を登録
   （`npx skills add` 等、リポジトリの手順どおり。`chrome-remote-interface` で 9222 に接続）。
3. Claude に「このスクリプトをPineエディタに入れてコンパイル、エラーを直して」等と指示すれば、
   記事の①（Pine開発ループ）②（チャート内部の読み取り）がそのまま動きます。

要点：**"TVを操作する部分" は本人PC**、**"プランを生成する・自分のアプリを検査する部分" はこの環境**、
と役割を分ければ、記事のワークフローは丸ごと再現できます。
