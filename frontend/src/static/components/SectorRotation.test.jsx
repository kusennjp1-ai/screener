import { screen,fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SectorRotation from './SectorRotation';
const groups=[{key:'Technology',label:'情報技術',relative:{63:{value:99},126:{value:110}},momentum21:{value:105},rates:{minervini:{percent:25}}}];
it('summarizes quadrants and reports hovered exported keys for table synchronization',()=>{
 const onHighlight=vi.fn();const {container,rerender}=renderWithProviders(<SectorRotation groups={groups} period="63" highlight={null} onHighlight={onHighlight}/>);
 expect(screen.getByRole('img',{name:/改善：情報技術/})).toBeInTheDocument();
 fireEvent.mouseEnter(container.querySelector('circle[data-sector="Technology"]'));
 expect(onHighlight).toHaveBeenCalledWith('Technology');
 rerender(<SectorRotation groups={groups} period="126" highlight="Technology" onHighlight={onHighlight}/>);
 expect(screen.getByRole('img',{name:/先導：情報技術/})).toBeInTheDocument();
 expect(container.querySelector('circle[data-sector="Technology"]')).toHaveAttribute('data-highlight','true');
 expect(screen.getByText(/JdKのRS-Ratio/)).toBeInTheDocument();
});
