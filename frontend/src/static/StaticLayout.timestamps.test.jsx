import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {ThemeProvider,createTheme} from '@mui/material/styles';
import StaticLayout from './StaticLayout';

const state=vi.hoisted(()=>({manifest:null}));
vi.mock('./dataClient',async importOriginal=>({...await importOriginal(),useStaticManifest:()=>({data:state.manifest})}));
beforeEach(()=>{state.manifest={generated_at:'2026-10-30T03:43:28Z',markets:{US:{market:'US',as_of_date:'2026-10-29'}}};});
afterEach(cleanup);
const view=()=>render(<MemoryRouter initialEntries={['/breadth']}><ThemeProvider theme={createTheme()}><StaticLayout><p>市場の内容</p></StaticLayout></ThemeProvider></MemoryRouter>);

describe('header timestamp provenance',()=>{
 it('labels the original export clock without claiming deployment or market observation time',()=>{
  const {container}=view();
  expect(screen.getByText('データ出力 2026/10/30 12:43:28 JST')).toBeInTheDocument();
  expect(container.querySelector('.header-dates')).toHaveTextContent('分析 2026-10-29');
  expect(container.querySelectorAll('.header-dates > span')).toHaveLength(2);
  expect(screen.queryByText(/^公開 /)).not.toBeInTheDocument();
  expect(state.manifest.generated_at).toBe('2026-10-30T03:43:28Z');
 });
 it.each([undefined,'not-a-timestamp'])('keeps absent or invalid export time unknown: %s',value=>{
  state.manifest.generated_at=value;view();
  expect(screen.getByText('データ出力 未確認')).toBeInTheDocument();
  expect(screen.queryByText(/^公開 /)).not.toBeInTheDocument();
 });
});
