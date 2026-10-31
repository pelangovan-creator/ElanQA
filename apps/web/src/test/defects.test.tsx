import { render, screen } from '@testing-library/react';
import { Tooltip } from '../components/Tooltip';
import { isHighImpact, SEVERITY_DEF } from '../lib/types';

describe('defect UI helpers', () => {
  it('tooltip is focusable and described by its definition', () => {
    render(<Tooltip tip={`Blocker: ${SEVERITY_DEF.Blocker}`} label="Severity Blocker"><span>Blocker</span></Tooltip>);
    const trigger = screen.getByLabelText('Severity Blocker');
    expect(trigger).toHaveAttribute('tabindex', '0');
    expect(trigger).toHaveAccessibleDescription(/no workaround/);
  });
  it('Blocker, Critical and P1 are high impact', () => {
    expect(isHighImpact({ severity: 'Major', priority: 'P1' })).toBe(true);
    expect(isHighImpact({ severity: 'Critical', priority: 'P3' })).toBe(true);
    expect(isHighImpact({ severity: 'Major', priority: 'P2' })).toBe(false);
  });
});
