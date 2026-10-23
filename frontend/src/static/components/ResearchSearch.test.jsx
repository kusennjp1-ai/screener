import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import ResearchSearch from './ResearchSearch';
afterEach(cleanup);
it('gives simultaneous inline and drawer searches unique labelled IDs and keeps debouncing',async()=>{
 const onChange=vi.fn();
 render(<><ResearchSearch value="" onChange={onChange}/><ResearchSearch value="" onChange={onChange}/></>);
 const inputs=screen.getAllByRole('textbox',{name:'銘柄・企業名を検索'});
 expect(inputs[0].id).not.toBe(inputs[1].id);
 fireEvent.change(inputs[0],{target:{value:'LEAD'}});
 expect(onChange).not.toHaveBeenCalled();
 await waitFor(()=>expect(onChange).toHaveBeenCalledWith('LEAD'));
});
it('reflects a reset value without emitting a stale query',()=>{
 const onChange=vi.fn();const view=render(<ResearchSearch value="LEAD" onChange={onChange}/>);
 view.rerender(<ResearchSearch value="" onChange={onChange}/>);
 expect(screen.getByRole('textbox')).toHaveValue('');expect(onChange).not.toHaveBeenCalled();
});
