import { useSyncExternalStore } from 'react';
import { Alert } from '@mui/material';
const subscribe=notify=>{window.addEventListener('online',notify);window.addEventListener('offline',notify);return()=>{window.removeEventListener('online',notify);window.removeEventListener('offline',notify);};};
export default function ConnectionStatus({date}) {
  const online=useSyncExternalStore(subscribe,()=>navigator.onLine,()=>true);
  return online?null:<Alert severity="warning">オフラインです。表示中の値は保存済みデータ（{date||'基準日未確認'}）です。新しい価格・判定を取得できません。</Alert>;
}
