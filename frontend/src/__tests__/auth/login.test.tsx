import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from '@/app/login/page';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
  usePathname: () => '/login',
}));

// ResizeObserver (not in jsdom)
global.ResizeObserver = class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver;

beforeEach(() => {
  mockPush.mockClear();
});

/**
 * 2026-05-10 (restore-wiring): the design pass landed a magic-link UI
 * shell on the login form, but the backend B.4 magic-link endpoint
 * isn't shipped — clicking the button silently advanced to a hidden
 * password field, leaving operators stuck. Until B.4 lands, the form
 * defaults to passwordMode=true so the working email+password flow
 * is the visible primary action. These tests verify the credentials
 * contract; the editorial hero (italic "Operator login.") is unchanged.
 *
 * Labels are uppercase eyebrow-italic per upstream commit `98e5f73`
 * (fix(frontend): match auth design login state). Use case-insensitive
 * matchers so they survive copy iteration.
 */
describe('Login Page', () => {
  it('renders email input field', () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toBeDefined();
  });

  it('renders the password field on first paint', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('PASSWORD')).toBeDefined();
  });

  it('password input has type password', () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText('PASSWORD') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');
  });

  it('renders the Sign in submit button', () => {
    render(<LoginPage />);
    const buttons = screen.getAllByText(/sign in/i);
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('Sign in button is disabled when email is empty', () => {
    render(<LoginPage />);
    const button = screen
      .getAllByText(/sign in/i)
      .find((el) => el.closest('button'))
      ?.closest('button');
    expect(button?.disabled).toBe(true);
  });

  it('renders AlphaDesk wordmark', () => {
    render(<LoginPage />);
    expect(screen.getByText('AlphaDesk')).toBeDefined();
  });

  it('username/email input has the design placeholder', () => {
    render(<LoginPage />);
    const input = screen.getByLabelText(/email/i) as HTMLInputElement;
    expect(input.placeholder).toBe('admin or you@firm.com');
  });

  it('renders the editorial Operator login heading', () => {
    render(<LoginPage />);
    expect(screen.getByText('Operator login.')).toBeDefined();
  });
});
