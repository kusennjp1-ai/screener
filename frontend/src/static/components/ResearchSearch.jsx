import { memo, useEffect, useId, useState } from 'react';
import { TextField } from '@mui/material';

// Typing updates only this input. The global search runs after a short pause.
export default memo(function ResearchSearch({value,onChange}) {
  const id=useId();
  const [input,setInput]=useState(value);
  useEffect(()=>setInput(value),[value]);
  useEffect(()=>{if(input===value)return;const timer=setTimeout(()=>onChange(input),150);return ()=>clearTimeout(timer);},[input,value,onChange]);
  return <TextField id={`candidate-search-${id}`} inputProps={{className:'candidate-search-input'}} label="銘柄・企業名を検索" value={input} onChange={e=>setInput(e.target.value)} onBlur={()=>{if(input!==value)onChange(input);}} size="small" sx={{width:{xs:'100%',md:260}}} />;
});
