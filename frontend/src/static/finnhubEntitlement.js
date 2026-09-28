// Personal contract probe. Credentials and provider data never enter exports.
export async function probeInstitutionalAccess(apiKey, symbol, cusip, now = new Date()) {
  if (!apiKey) return {state:'disconnected',label:'価格接続のAPIキーが未入力です'};
  if (!symbol || !cusip) return {state:'identity_missing',label:'銘柄のCUSIP照合が未完了です'};
  const to=now.toISOString().slice(0,10),from=new Date(now.getTime()-180*86400000).toISOString().slice(0,10);
  const params=new URLSearchParams({symbol,cusip,from,to,token:apiKey});
  try {
    const response=await fetch(`https://finnhub.io/api/v1/institutional/ownership?${params}`,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)});
    if ([401,403].includes(response.status)) return {state:'denied',label:`機関投資家APIの権限なし／認証を確認（HTTP ${response.status}）`};
    if (response.status===429) return {state:'limited',label:'API利用上限に達しています'};
    if (!response.ok) return {state:'error',label:`取得エラー（HTTP ${response.status}）`};
    const data=await response.json();
    if(data?.error) return {state:'error',label:'提供元がエラーを返しました'};
    return {state:Array.isArray(data?.data)&&data.data.length?'available':'empty',label:Array.isArray(data?.data)&&data.data.length?'機関投資家APIに接続できました（個人契約・公開データへの転載は行いません）':'APIには接続できましたが、この期間の保有履歴は空です'};
  } catch {return {state:'error',label:'通信に失敗しました。契約権限は未確認です'};}
}
