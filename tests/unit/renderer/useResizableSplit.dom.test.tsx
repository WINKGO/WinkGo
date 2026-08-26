/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useResizableSplit } from '@/renderer/hooks/ui/useResizableSplit';

const Harness = ({ reverse = false }: { reverse?: boolean }) => {
  const { splitRatio, createDragHandle } = useResizableSplit({
    unit: 'px',
    defaultWidth: 480,
    minWidth: 340,
    maxWidth: 1200,
    storageKey: 'test-browser-preview-width',
  });

  return (
    <div>
      <output data-testid='width'>{splitRatio}</output>
      <div className='relative'>
        {createDragHandle({
          reverse,
          compact: true,
          ariaLabel: '调整浏览器面板宽度',
        })}
      </div>
    </div>
  );
};

beforeEach(() => {
  localStorage.clear();
});

describe('useResizableSplit accessible preview handle', () => {
  it('renders an obvious compact separator with accessible value metadata', () => {
    render(<Harness />);

    const separator = screen.getByRole('separator', { name: '调整浏览器面板宽度' });
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuemin', '340');
    expect(separator).toHaveAttribute('aria-valuemax', '1200');
    expect(separator).toHaveAttribute('aria-valuenow', '480');
    expect(separator.querySelector('[data-winkgo-resize-grip="true"]')).not.toBeNull();
  });

  it('resizes and persists with the keyboard, including reverse-mounted panels', () => {
    const { rerender } = render(<Harness />);
    const separator = screen.getByRole('separator');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(screen.getByTestId('width')).toHaveTextContent('504');
    expect(localStorage.getItem('test-browser-preview-width')).toBe('504');

    rerender(<Harness reverse />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' });
    expect(screen.getByTestId('width')).toHaveTextContent('480');

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'Home' });
    expect(screen.getByTestId('width')).toHaveTextContent('340');
  });
});
