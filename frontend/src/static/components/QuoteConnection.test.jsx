import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import QuoteConnection from './QuoteConnection';
it('hands the key to the memory-only connection and immediately clears the form',()=>{
 const connect=vi.fn();render(<QuoteConnection connected={false} onConnect={connect}/>);
 fireEvent.click(screen.getByText('場中価格を接続する'));
 const input=screen.getByLabelText('Finnhub APIキー');
 fireEvent.change(input,{target:{value:'test-private-key'}});
 fireEvent.click(screen.getByRole('button',{name:'価格配信に接続'}));
 expect(connect).toHaveBeenCalledWith('test-private-key');expect(input.value).toBe('');
 expect(localStorage.getItem('finnhub-key')).toBeNull();
});
