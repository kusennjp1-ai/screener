import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import { advanceDailyWatch, advanceLiveWatch, deliverLocalWatchNotification, readWatchState, watchStorage, WATCH_NOTIFICATION_KEY, WATCH_NOTIFICATION_PREFERENCE } from '../watchNotifications';
const EMPTY = [];
const METHOD_NAMES = { minervini: 'ミネルヴィニ', minervini2: '基本と原則', oneil: 'オニール', ibd: 'IBD型' };

function readPreference() { try { return localStorage.getItem(WATCH_NOTIFICATION_PREFERENCE) === 'true'; } catch { return false; } }

export default function WatchNotifications({ rows = EMPTY, watch = EMPTY, asOf, method = 'minervini', personalConnected = false, personalQuote = null, onSelect }) {
  const [daily, setDaily] = useState(() => readWatchState(watchStorage())), [live, setLive] = useState([]);
  const [enabled, setEnabled] = useState(readPreference), [status, setStatus] = useState(''), [storageError, setStorageError] = useState(false);
  const current = useRef(daily), liveObservation = useRef(null), enabledRef = useRef(enabled);
  const rowMap = useMemo(() => new Map(rows.map(row => [row.symbol, row])), [rows]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => {
    let active = true;
    const update = async () => {
      if (!active) return;
      const persisted = readWatchState(watchStorage());
      const previous = storageError ? current.current : persisted;
      const { state, added } = advanceDailyWatch(previous, { rows: rowMap, watch, asOf, method });
      current.current = state;
      try { localStorage.setItem(WATCH_NOTIFICATION_KEY, JSON.stringify(state)); } catch { setStorageError(true); }
      setDaily(state);
      for (const event of added) try { await deliverLocalWatchNotification(event, { enabled: enabledRef.current }); } catch { setStatus('端末通知を表示できません。アプリ内の一覧で確認できます。'); }
    };
    if (globalThis.navigator?.locks?.request) navigator.locks.request(WATCH_NOTIFICATION_KEY, update).catch(() => { if (active) setStatus('通知履歴の更新に失敗しました。再読込して確認してください。'); });
    else update();
    return () => { active = false; };
  }, [rowMap, watch, asOf, method, storageError]);
  useEffect(() => {
    const sync = event => { if (event.key === WATCH_NOTIFICATION_KEY) { const state = readWatchState(watchStorage()); current.current = state; setDaily(state); } };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  useEffect(() => {
    const { observation, event } = advanceLiveWatch(liveObservation.current, { row: rowMap.get(personalQuote?.symbol), watch, asOf, method, quote: personalQuote, connected: personalConnected });
    liveObservation.current = observation;
    if (event) {
      setLive(previous => previous.some(item => item.id === event.id) ? previous : [event, ...previous].slice(0, 100));
      deliverLocalWatchNotification(event, { enabled: enabledRef.current }).catch(() => setStatus('端末通知を表示できません。アプリ内の一覧で確認できます。'));
    }
  }, [rowMap, watch, asOf, method, personalQuote, personalConnected]);
  const events = useMemo(() => [...daily.events, ...live].sort((a, b) => b.observed_at.localeCompare(a.observed_at)), [daily.events, live]);
  const toggleNotifications = async () => {
    if (enabled) { setEnabled(false); try { localStorage.setItem(WATCH_NOTIFICATION_PREFERENCE, 'false'); } catch { setStorageError(true); } return; }
    if (!globalThis.Notification) { setStatus('この環境は端末通知に対応していません。アプリ内の一覧を利用できます。'); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') { setEnabled(true); setStatus('以後の新しい変化を端末に通知します。'); try { localStorage.setItem(WATCH_NOTIFICATION_PREFERENCE, 'true'); } catch { setStorageError(true); } }
      else setStatus('端末通知は許可されていません。アプリ内の一覧は利用できます。');
    } catch { setStatus('通知の許可を確認できません。アプリ内の一覧を利用できます。'); }
  };
  return <Box component="details" className="research-watch-notifications" sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: '16px', '& > summary': { cursor: 'pointer', minHeight: 44, fontSize: 14, fontWeight: 700 } }}>
    <summary>ウォッチの状態変化 · {events.length}件</summary>
    <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 1 }}>新しい日次データを開いたとき、最後に確認した基準日からの価格位置の変化を記録します。購入条件の通過を示す通知ではありません。</Typography>
    <Button onClick={toggleNotifications} sx={{ minHeight: 44 }}>{enabled ? '端末通知を止める' : '端末通知を有効にする'}</Button>
    <Typography sx={{ fontSize: 12, color: 'text.secondary', my: 1 }}>アプリを閉じている間の常時監視には対応していません。場中通知はFinnhubへ接続して受信中のウォッチ銘柄だけが対象で、このタブ内に保持します。APIキー・配信価格は保存しません。</Typography>
    {status && <Typography role="status" sx={{ fontSize: 13 }}>{status}</Typography>}
    {storageError && <Alert severity="warning">通知履歴を端末へ保存できません。このタブ内だけで保持します。</Alert>}
    {!watch.length && <Typography sx={{ fontSize: 13 }}>銘柄の☆からウォッチへ追加すると、次の変化から記録します。</Typography>}
    {watch.length > 0 && !events.length && <Typography sx={{ fontSize: 13 }}>変化はまだありません。初回・未確認データからの状態を通知として作りません。</Typography>}
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {events.slice(0, 50).map(event => <Box component="li" key={event.id} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Button disabled={!onSelect || !rowMap.has(event.symbol)} onClick={() => onSelect?.(event.symbol)} sx={{ minHeight: 44, fontSize: 14 }}>{event.symbol} · {event.from} → {event.to}</Button>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{METHOD_NAMES[event.method] || '方式未確認'} · {event.source === 'daily' ? `日次 ${event.previous_as_of} → ${event.as_of}` : `接続価格 ${new Date(event.observed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST · このタブ内のみ`}</Typography>
      </Box>)}
    </Box>
    {events.length > 50 && <Typography sx={{ fontSize: 12 }}>最新50件を表示しています。</Typography>}
  </Box>;
}
