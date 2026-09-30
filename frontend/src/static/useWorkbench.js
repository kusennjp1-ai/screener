import { useQuery } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
export function useWorkbench(entry) {
  const ref=entry?.assets?.workbench;
  return useQuery({queryKey:['workbench',ref?.path],enabled:Boolean(ref?.path),staleTime:Infinity,placeholderData:()=>undefined,
    queryFn:async()=>{
      const data=await fetchStaticJson(ref.path,{sha256:ref.sha256});
      if(data.as_of!==entry.as_of_date || data.snapshot_id!==ref.snapshot_id) throw Error('Snapshot identity mismatch');
      return data;
    }});
}
