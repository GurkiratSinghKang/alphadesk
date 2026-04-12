import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Placeholder } from '@/components/ui/placeholder';

describe('Placeholder component', () => {
  it('renders placeholder text for null value', () => {
    const { container } = render(<Placeholder value={null} format="currency" />);
    expect(container.textContent).toBe('$--.--');
  });

  it('renders placeholder for undefined', () => {
    const { container } = render(<Placeholder value={undefined} format="percent" />);
    expect(container.textContent).toBe('--.-%');
  });

  it('renders placeholder for NaN', () => {
    const { container } = render(<Placeholder value={NaN} format="integer" />);
    expect(container.textContent).toBe('--');
  });

  it('renders formatted value for valid number', () => {
    const { container } = render(<Placeholder value={1234.56} format="currency" />);
    expect(container.textContent).toBe('$1,234.56');
  });

  it('renders text placeholder for text format', () => {
    const { container } = render(<Placeholder value={null} format="text" />);
    expect(container.textContent).toBe('---');
  });

  it('renders actual text for text format', () => {
    const { container } = render(<Placeholder value="Hello" format="text" />);
    expect(container.textContent).toBe('Hello');
  });

  it('renders integer placeholder for null', () => {
    const { container } = render(<Placeholder value={null} format="integer" />);
    expect(container.textContent).toBe('--');
  });

  it('renders percent placeholder for null', () => {
    const { container } = render(<Placeholder value={null} format="percent" />);
    expect(container.textContent).toBe('--.-%');
  });

  it('renders currency placeholder for Infinity', () => {
    const { container } = render(<Placeholder value={Infinity} format="currency" />);
    expect(container.textContent).toBe('$--.--');
  });

  it('renders currency placeholder for -Infinity', () => {
    const { container } = render(<Placeholder value={-Infinity} format="currency" />);
    expect(container.textContent).toBe('$--.--');
  });

  it('renders formatted integer for valid number', () => {
    const { container } = render(<Placeholder value={42} format="integer" />);
    expect(container.textContent).toBe('42');
  });

  it('rounds integer format values', () => {
    const { container } = render(<Placeholder value={3.7} format="integer" />);
    expect(container.textContent).toBe('4');
  });

  it('renders formatted percent for valid number', () => {
    const { container } = render(<Placeholder value={5.5} format="percent" />);
    // formatValue: percentFmt.format(5.5 / 100) = "+5.50%"
    expect(container.textContent).toBe('+5.50%');
  });

  it('renders negative percent for negative number', () => {
    const { container } = render(<Placeholder value={-3.2} format="percent" />);
    expect(container.textContent).toBe('-3.20%');
  });

  it('applies custom className', () => {
    const { container } = render(
      <Placeholder value={null} format="currency" className="my-custom-class" />
    );
    expect(container.querySelector('.my-custom-class')).toBeDefined();
  });

  it('renders zero currency correctly', () => {
    const { container } = render(<Placeholder value={0} format="currency" />);
    expect(container.textContent).toBe('$0.00');
  });

  it('renders negative currency correctly', () => {
    const { container } = render(<Placeholder value={-50} format="currency" />);
    expect(container.textContent).toBe('-$50.00');
  });

  it('renders string passthrough for text format', () => {
    const { container } = render(<Placeholder value="AAPL" format="text" />);
    expect(container.textContent).toBe('AAPL');
  });
});
