/**
 * Table formatting utility for CLI output
 *
 * Provides consistent table rendering using cli-table3.
 */

import Table from 'cli-table3';

export interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: 'left' | 'center' | 'right';
  formatter?: (value: unknown, row: Record<string, unknown>) => string;
}

export interface TableOptions {
  columns: TableColumn[];
  compact?: boolean;
  noHeader?: boolean;
}

/**
 * Render data as a table
 */
export function renderTable(
  data: Record<string, unknown>[],
  options: TableOptions
): string {
  const { columns, compact = false, noHeader = false } = options;

  const tableConfig: Table.TableConstructorOptions = {
    head: noHeader ? [] : columns.map((c) => c.header),
    style: {
      head: ['cyan'],
      border: compact ? [] : ['grey'],
    },
  };

  // Only set colWidths if any column has a width defined
  if (columns.some((c) => c.width)) {
    tableConfig.colWidths = columns.map((c) => c.width ?? null);
  }

  if (compact) {
    tableConfig.chars = {
      top: '',
      'top-mid': '',
      'top-left': '',
      'top-right': '',
      bottom: '',
      'bottom-mid': '',
      'bottom-left': '',
      'bottom-right': '',
      left: '',
      'left-mid': '',
      mid: '',
      'mid-mid': '',
      right: '',
      'right-mid': '',
      middle: '  ',
    };
  }

  const table = new Table(tableConfig);

  for (const row of data) {
    const rowData = columns.map((col) => {
      const value = row[col.key];
      if (col.formatter) {
        return col.formatter(value, row);
      }
      return value != null ? String(value) : '';
    });
    table.push(rowData);
  }

  return table.toString();
}

/**
 * Format a date for display
 */
export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format relative time (e.g., "2h ago")
 */
export function formatRelative(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return 'just now';
}

/**
 * Format status with indicator
 */
export function formatStatus(status: string): string {
  const indicators: Record<string, string> = {
    success: '\u2713', // checkmark
    complete: '\u2713',
    running: '\u25CF', // filled circle
    ready: '\u25CB', // empty circle
    pending: '\u25CB',
    fail: '\u2717', // X
    failed: '\u2717',
    error: '\u2717',
    pause: '\u25A0', // square
    paused: '\u25A0',
    skip: '\u25A1', // empty square
    stopped: '\u25A0',
    halted: '\u25A0',
    processing: '\u25CF',
  };
  const indicator = indicators[status.toLowerCase()] ?? '\u25CF';
  return `${indicator} ${status}`;
}

/**
 * Truncate string to max length
 */
export function truncate(str: string | undefined | null, maxLen: number): string {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}
