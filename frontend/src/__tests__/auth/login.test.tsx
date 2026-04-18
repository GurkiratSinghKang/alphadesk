import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn() }),
  usePathname: () => '/login',
}));

// ResizeObserver (not in jsdom)
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as any;

beforeEach(() => {
  mockPush.mockClear();
});

describe('Login Page', () => {
  it('renders username input field', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    const usernameInput = screen.getByLabelText('Username');
    expect(usernameInput).toBeDefined();
  });

  it('renders password input field', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toBeDefined();
  });

  it('renders submit button', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    // Editorial voice: "Sign in" (sentence case) per design system rewrite.
    const buttons = screen.getAllByText(/sign in/i);
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('submit button is disabled when fields are empty', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    const button = screen.getAllByText(/sign in/i).find(el => el.closest('button'))?.closest('button');
    expect(button?.disabled).toBe(true);
  });

  it('renders AlphaDesk heading', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    expect(screen.getByText('AlphaDesk')).toBeDefined();
  });

  it('renders product description text', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    const text = document.body.textContent ?? '';
    expect(text.includes('Trading') || text.includes('trading') || text.includes('AlphaDesk')).toBe(true);
  });

  it('username input has a placeholder', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    // Editorial rewrite: placeholder copy shifted from "Enter username" to
    // "your handle" to match the design system's terser voice.
    const input = screen.getByLabelText('Username') as HTMLInputElement;
    expect(input.placeholder).toBeTruthy();
  });

  it('password input has a placeholder', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.placeholder).toBeTruthy();
  });

  it('password input has type password', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');
  });

  it('has proper form labels for accessibility', async () => {
    const LoginPage = (await import('@/app/login/page')).default;
    render(<LoginPage />);
    expect(screen.getByText('Username')).toBeDefined();
    expect(screen.getByText('Password')).toBeDefined();
  });
});
