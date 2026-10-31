import { render, screen } from '@testing-library/react';
import { Table } from '../components/ui';
import { ReviewStatus } from '../pages/artefacts/shared';

describe('artefact UI pieces', () => {
  it('labels blank table headers for screen readers (no duplicate keys)', () => {
    render(<Table head={['', 'TC ID', '']} caption="x"><tr><td>a</td><td>b</td><td>c</td></tr></Table>);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Select', 'TC ID', 'Actions']);
  });

  it('marks machine-generated items as pending review until approved', () => {
    const { rerender } = render(<ReviewStatus item={{ aiGenerated: true, reviewStatus: 'PendingReview' }} />);
    expect(screen.getByText('AI-generated – pending review')).toBeInTheDocument();
    rerender(<ReviewStatus item={{ aiGenerated: true, reviewStatus: 'Approved' }} />);
    expect(screen.queryByText(/AI-generated/)).toBeNull();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    rerender(<ReviewStatus item={{ aiGenerated: false, reviewStatus: 'Rejected', reviewComment: 'Add a negative step' }} />);
    expect(screen.getByText('“Add a negative step”')).toBeInTheDocument();
  });
});
