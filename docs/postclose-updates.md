# 米国引け後の更新

更新判定は NYSE の営業日・実際の終了時刻を使う。土日祝日を営業日に
置き換えない。夏時間の通常引けは 20:00 UTC、冬時間は 21:00 UTC。
短縮取引も同じカレンダーで扱う。

`Post-close Update Watchdog` は米東部時間 13〜20 時の毎時
02/12/22/32/42/52 分に検査する。終了 2 分後から当日の取得を要求できる。
00:17/06:17/10:17 にも毎日確認し、実行漏れや配信遅延を回復する。
これは初回取得の目標時刻であり、公開完了時刻の保証ではない。

実際の公開 `publication.json` → SHA-256 が一致する manifest → SHA-256 が
一致する市場時系列を読む。最後に公開 receipt が変わっていないことも確認する。
生成時刻を取引日として使わず、スキャン・実際の個別日足・高値安値・先導株・
業種別広がり・S&P 500・セクター RS・分配日・Cboe P/C の観測日を比較する。
個別日足の確認は公開 chart observation の 90% 以上が当日であることを要求する。
未更新の銘柄がゼロという保証ではなく、各銘柄には自身の観測日が残る。

未更新で取得／公開ジョブが動いていなければ既存の `Static Site` を要求する。
初回から全 US 取得を使う。現在の `prices_only` は公開済みスキャン日までしか
チャートを出力できないため、引け後の日付更新には使わない。手動キャッシュ更新
としては残すが、高速な当日公開を実現する経路ではない。
16:10 ET と 23:30 UTC の予備実行も監視 workflow に集約し、全自動実行に同じ
進行中ジョブ・公開済み観測日・再試行間隔の判定を適用する。取得 workflow 自体に
直接の定時実行はない。米国の全件取得対象日も実際の引け後2分で当日に切り替わる。
これは取得開始の判定であり、提供元の当日データ到着や品質検査を省略しない。
取得が成功しても公開トリガーが届かなければ既存の
`Research UI Release` を要求する。公開失敗は同じ取得結果につき一度だけ再試行。
承認、財務データ品質、出典、巻き戻し防止、公開直前検査は既存のものを維持する。
監視 workflow に Pages デプロイ権限はない。

取得再試行は完了後 10/20/30/40/50 分の間隔を取り、6 回以降は 6 時間まで
間隔を広げる。状態は GitHub の実行履歴から再構成し、runner や cache の消失で
リセットしない。Cboe P/C だけが遅い場合、株価や長期履歴の公開を止めない。
引け後 90 分まで待ち、その後は同一営業日につき最大 2 回、最低 2 時間間隔で
追加取得する。引き続き未取得なら実際の最終観測日を残し、翌営業日の取得で
追いつく。古い数値を今日の値として表示しない。

株価・長期履歴などが引け後 120 分、P/C だけの場合は 240 分を超えて未更新なら
workflow を失敗として記録する。更新要求自体は失敗表示の前に行う。
観測日・不足データ・処置は Actions の Summary と 7 日保持の JSON artifact に残る。
外部へのコメント、メール、Slack メッセージは送らない。

GitHub は schedule が混雑で遅延・欠落する可能性を明記している。同じ GitHub
基盤の複数 schedule は完全に独立した監視ではない。GitHub 全体の停止や元データの
未配信中に、即時公開を保証することはできない。厳格な時刻 SLA が必要な場合は
別基盤の時計からこの workflow の `workflow_dispatch` を呼ぶ構成が必要になる。

資料:

- [NYSE trading hours and calendar](https://www.nyse.com/markets/hours-calendars)
- [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GITHUB_TOKEN and workflow_dispatch](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)

## 検証

`python -m unittest discover -s .github/scripts -p test_postclose_calendar.py`
で夏冬時間、DST 変更、短縮取引、休日、年越しを確認する。
`node --test .github/scripts/postclose-watchdog.test.mjs` で監視・出典検証・
重複防止・再試行上限を確認する。

`node .github/scripts/postclose-watchdog.mjs --output <path>` は読み取りのみ。
`--execute` は本リポジトリの main 上の GitHub Actions からしか許可しない。
