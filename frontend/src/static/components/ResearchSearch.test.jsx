import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ResearchSearch from './ResearchSearch';

afterEach(()=>{cleanup();vi.useRealTimers();});
it('commits a pending search on blur before a drawer closes, retaining the typing debounce',()=>{
 vi.useFakeTimers();
 const onChange=vi.fn();
 const {unmount}=render(<ResearchSearch value="" onChange={onChange}/>);
 const input=screen.getByLabelText('銘柄・企業名を検索');
 fireEvent.change(input,{target:{value:'TEST57'}});
 expect(onChange).not.toHaveBeenCalled();
 fireEvent.blur(input);
 expect(onChange).toHaveBeenCalledWith('TEST57');
 unmount();
 vi.advanceTimersByTime(150);
 expect(onChange).toHaveBeenCalledTimes(1);
});
