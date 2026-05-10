import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('renders email input field', () => {
    render(<LoginPage />);
    const emailInput = screen.getByLabelText('Email');
    expect(emailInput).toBeDefined();
  });

  it('keeps the password challenge out of the initial magic-link state', () => {
    render(<LoginPage />);
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('renders submit button', () => {
    render(<LoginPage />);
    const buttons = screen.getAllByText(/email me a magic link/i);
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('magic-link submit button is disabled when email is empty', () => {
    render(<LoginPage />);
    const button = screen.getAllByText(/email me a magic link/i).find(el => el.closest('button'))?.closest('button');
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

  it('email input has the design placeholder', () => {
    render(<LoginPage />);
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.placeholder).toBe('you@firm.com');
  });

  it('reveals password fallback after choosing a credential path', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('Authenticator code'));
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.placeholder).toBeTruthy();
  });

  it('password fallback input has type password', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('Authenticator code'));
    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');
  });

  it('has proper initial form labels and security-key affordances', () => {
    render(<LoginPage />);
    expect(screen.getByText('Email')).toBeDefined();
    expect(screen.getByText('Or use a security key')).toBeDefined();
    expect(screen.getByText('YubiKey · Touch ID')).toBeDefined();
    expect(screen.getByText('Authenticator code')).toBeDefined();
  });
});
