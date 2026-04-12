import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: Wrapper, ...options });
}
