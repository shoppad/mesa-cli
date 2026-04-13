/**
 * Tests for table formatting utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatDate, formatRelative, formatStatus, truncate, renderTable } from './table.js';

describe('Table Utilities', () => {
  describe('formatDate', () => {
    it('formats valid date string', () => {
      const result = formatDate('2024-01-15T10:30:00Z');
      assert.ok(result.includes('Jan'), `Expected "Jan" in "${result}"`);
      assert.ok(result.includes('15'), `Expected "15" in "${result}"`);
    });

    it('returns dash for undefined', () => {
      assert.strictEqual(formatDate(undefined), '-');
    });

    it('returns dash for null', () => {
      assert.strictEqual(formatDate(null), '-');
    });

    it('returns dash for invalid date', () => {
      assert.strictEqual(formatDate('not-a-date'), '-');
    });
  });

  describe('formatRelative', () => {
    it('shows "just now" for recent dates', () => {
      const now = new Date().toISOString();
      assert.strictEqual(formatRelative(now), 'just now');
    });

    it('shows minutes ago', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      assert.strictEqual(formatRelative(fiveMinutesAgo), '5m ago');
    });

    it('shows hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      assert.strictEqual(formatRelative(twoHoursAgo), '2h ago');
    });

    it('shows days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
      assert.strictEqual(formatRelative(threeDaysAgo), '3d ago');
    });

    it('returns dash for undefined', () => {
      assert.strictEqual(formatRelative(undefined), '-');
    });

    it('returns dash for null', () => {
      assert.strictEqual(formatRelative(null), '-');
    });
  });

  describe('formatStatus', () => {
    it('formats success status with checkmark', () => {
      const result = formatStatus('success');
      assert.ok(result.includes('\u2713'), `Expected checkmark in "${result}"`);
      assert.ok(result.includes('success'), `Expected "success" in "${result}"`);
    });

    it('formats fail status with X', () => {
      const result = formatStatus('fail');
      assert.ok(result.includes('\u2717'), `Expected X in "${result}"`);
    });

    it('formats running status with filled circle', () => {
      const result = formatStatus('running');
      assert.ok(result.includes('\u25CF'), `Expected filled circle in "${result}"`);
    });

    it('formats ready status with empty circle', () => {
      const result = formatStatus('ready');
      assert.ok(result.includes('\u25CB'), `Expected empty circle in "${result}"`);
    });

    it('handles unknown status with default indicator', () => {
      const result = formatStatus('unknown');
      assert.ok(result.includes('unknown'), `Expected "unknown" in "${result}"`);
    });
  });

  describe('truncate', () => {
    it('truncates long strings', () => {
      const result = truncate('This is a very long string', 15);
      assert.strictEqual(result.length, 15);
      assert.ok(result.endsWith('...'), `Expected "..." at end of "${result}"`);
    });

    it('leaves short strings unchanged', () => {
      const result = truncate('Short', 15);
      assert.strictEqual(result, 'Short');
    });

    it('handles exact length string', () => {
      const result = truncate('Exactly15chars!', 15);
      assert.strictEqual(result, 'Exactly15chars!');
    });

    it('handles undefined', () => {
      assert.strictEqual(truncate(undefined, 15), '');
    });

    it('handles null', () => {
      assert.strictEqual(truncate(null, 15), '');
    });
  });

  describe('renderTable', () => {
    it('renders simple table', () => {
      const data = [
        { name: 'Test', id: '123' },
        { name: 'Another', id: '456' },
      ];

      const result = renderTable(data, {
        columns: [
          { header: 'Name', key: 'name' },
          { header: 'ID', key: 'id' },
        ],
      });

      assert.ok(result.includes('Name'), `Expected "Name" header in table`);
      assert.ok(result.includes('ID'), `Expected "ID" header in table`);
      assert.ok(result.includes('Test'), `Expected "Test" in table`);
      assert.ok(result.includes('123'), `Expected "123" in table`);
    });

    it('uses formatter when provided', () => {
      const data = [{ status: 'success' }];

      const result = renderTable(data, {
        columns: [
          {
            header: 'Status',
            key: 'status',
            formatter: (v) => `[${String(v).toUpperCase()}]`,
          },
        ],
      });

      assert.ok(result.includes('[SUCCESS]'), `Expected "[SUCCESS]" in table`);
    });

    it('handles missing values', () => {
      const data = [{ name: 'Test' }];

      const result = renderTable(data, {
        columns: [
          { header: 'Name', key: 'name' },
          { header: 'Missing', key: 'missing' },
        ],
      });

      assert.ok(result.includes('Test'), `Expected "Test" in table`);
    });
  });
});
