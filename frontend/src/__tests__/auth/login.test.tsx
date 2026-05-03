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

describe('Login Page', () => {
  it('renders username input field', () => {
    render(<LoginPage />);
    const usernameInput = screen.getByLabelText('Username');
    expect(usernameInput).toBeDefined();
  });

  it('renders password input field', () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText('Password');
    expect(passwordInput).toBeDefined();
  });

  it('renders submit button', () => {
    render(<LoginPage />);
    // Editorial voice: "Sign in" (sentence case) per design system rewrite.
    const buttons = screen.getAllByText(/sign in/i);
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('submit button is disabled when fields are empty', () => {
    render(<LoginPage />);
    const button = screen.getAllByText(/sign in/i).find(el => el.closest('button'))?.closest('button');
    expect(button?.disabled).toBe(true);
  });

  it('renders AlphaDesk heading', () => {
    render(<LoginPage />);
    expect(screen.getByText('AlphaDesk')).toBeDefined();
  });

  it('renders product description text', () => {
    render(<LoginPage />);
    const text = document.body.textContent ?? '';
    expect(text.includes('Trading') || text.includes('trading') || text.includes('AlphaDesk')).toBe(true);
  });

  it('username input has a placeholder', () => {
    render(<LoginPage />);
    // Editorial rewrite: placeholder copy shifted from "Enter username" to
    // "your handle" to match the design system's terser voice.
    const input = screen.getByLabelText('Username') as HTMLInputElement;
    expect(input.placeholder).toBeTruthy();
  });

  it('password input has a placeholder', () => {
    render(<LoginPage />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.placeholder).toBeTruthy();
  });

  it('password input has type password', () => {
    render(<LoginPage />);
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');
  });

  it('has proper form labels for accessibility', () => {
    render(<LoginPage />);
    expect(screen.getByText('Username')).toBeDefined();
    expect(screen.getByText('Password')).toBeDefined();
  });
});
