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
`Research UI Release` を要求する。公開失敗は同じ取得結果につき一度だけ、
失敗の 10 分後に再試行する。それより前の検査はその再試行を待ち
（`publication_retry_grace`）、全取得には進まない。
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

## 時計による起動（Post-close Watchdog Timer）

schedule に頼らず、監視は自分で次の検査時刻 `plan.wake_at` を決める。
公開済みなら次の実際の引け（`next_close`）＋60 分。16:00 ET の通常の引けなら
冬時間 22:00Z・夏時間 21:00Z、13:00 ET の短縮取引なら引けが冬時間 18:00Z・
夏時間 17:00Z なので起動は冬時間 19:00Z（例: 2026-11-27、2026-12-24）・
夏時間 18:00Z（例: 2028-07-03）。休日・短縮取引・夏時間は監視と同じ NYSE
カレンダーから取る。
待ち・再試行間隔の分岐はその間隔が終わる時刻、取得／公開を要求した場合は
成功時の起動を待ちつつ保険として 5 時間 45 分後。どの時刻も 1 分後以降、
次の引け＋60 分以前に収める。公開に成功した `Research UI Release` の終了から
10 分間（`PUBLICATION_SETTLE_MINUTES`）は、どの分岐の時刻もその終わりまで
遅らせる。Pages が直前の公開をまだ返している間に起きて、公開したばかりの
セッションを未公開として全取得し直さないためである。時刻を決めても判定は
変わらず、引け後 2 分の猶予と公開後 2 分の伝搬猶予も変えない。この遅らせは
公開の完了を見た検査が決めた時刻だけに効く。schedule などタイマー以外で
始まった検査、公開が終わる前に決まりその後決め直されなかった時刻
（`workflow_run` の公開には終了時の起動 job がない）、公開の run がまだ
進行中に見えた検査の時刻、レポートが使えない場合の 1 時間後で起きた検査は、
従来どおりその時点の観測で判定する。

監視の最後のステップ（失敗や遅延の exit 1 でも動く）が、この時刻を
`Post-close Watchdog Timer` に渡す。レポートが無い・壊れている・要求の
受理が確認できない場合は 1 時間後。タイマーは 1 本の job が待ち、時刻に
なると監視を入力なしで要求する。job は 6 時間までなので、それより先の時刻は
5 時間 45 分ごとに同じ時刻で自分を要求し直す（待ち方 A1）。待っているのは
常に最新の 1 本だけ（`cancel-in-progress: true`）なので、監視は要求の前に
待機中のタイマーの時刻を run 名から読み（GET のみ）、そちらが早ければその
時刻を引き継いで要求する。1 時間後の予備や進行中の 1 時間待ちが、より近い
10 分後の再試行を上書きしない。ただし上の公開後 10 分以内に入る時刻は
引き継がない。時刻を過ぎた run（いま監視を起こしている run）は待機中と
みなさない。読めない場合は従来どおり自分の時刻を要求する。6 時間以上前の
時刻は要求しない。タイマーは判定も公開もしない。権限は `contents: read` と
`actions: write` のみ。上の schedule はすべて残し、つながりが切れたときの
予備にする。待ち方を environment の待機（A2）や外部の時計（B）に替える
場合も、変えるのはタイマー側だけで `wake_at` はそのまま使える。

## 失敗・公開の終了時の起動

取得の成功時は従来どおり `Static Site` の最後の job が監視を起こし、
監視はその run の完了と 2 分の猶予を待つ。取得が失敗した run（main への
`workflow_dispatch`）も最後の job が監視を入力なしで起こし、監視は実行履歴の
再試行間隔の終わりをタイマーに渡す。監視が要求した `Research UI Release` は
GITHUB_TOKEN の `workflow_dispatch` なので `workflow_run` を生まない。そこで
公開・失敗のどちらで終わっても最後の job が監視を入力なしで起こす。失敗なら
失敗の 10 分後の一度だけの再試行、公開なら終了の 10 分後の確認になる。
どちらの起動 job も `actions: write` だけを持ち、checkout・environment・
Pages を使わない。起動に失敗しても run の結果は変えない
（`continue-on-error`）。起動 job はその run の一部なので、監視が run の
完了前に履歴を読むと従来どおり進行中として 1 時間後に起きる。

資料:

- [NYSE trading hours and calendar](https://www.nyse.com/markets/hours-calendars)
- [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GITHUB_TOKEN and workflow_dispatch](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)

## 検証

`python -m unittest discover -s .github/scripts -p test_postclose_calendar.py`
で夏冬時間、DST 変更、短縮取引、休日、年越しを確認する。
`node --test .github/scripts/postclose-watchdog.test.mjs` で監視・出典検証・
重複防止・再試行上限・次の検査時刻を確認する。
`POSTCLOSE_PYTHON=<固定版カレンダーの python> node --test .github/scripts/postclose-timer.test.mjs`
で実カレンダーからの起動時刻（感謝祭、短縮取引、週末、夏時間）とタイマーの
待ち・再要求・期限切れを確認する。

`node .github/scripts/postclose-watchdog.mjs --output <path>` は読み取りのみ。
`--execute` は本リポジトリの main 上の GitHub Actions からしか許可しない。
