import '../setup-mocks';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import DashboardLayout from '@/components/layouts/DashboardLayout';

describe('DashboardLayout', () => {
  it('keeps the right rail stacked until the lg breakpoint', () => {
    const { container } = render(
      <DashboardLayout
        topBar={<div>top</div>}
        contextBar={<div>context</div>}
        center={<div>center</div>}
        right={<div>right</div>}
        statusBar={<div>status</div>}
      />,
    );

    const rightRail = container.querySelector('[data-slot="dashboard-right"]');
    expect(rightRail?.className).toContain('lg:col-start-2');
    expect(rightRail?.className).not.toContain('md:col-start-2');
  });
});
