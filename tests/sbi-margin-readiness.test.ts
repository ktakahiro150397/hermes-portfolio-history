import { describe, expect, it } from 'vitest';
import { assessSbiMarginHistory } from '@/import/sbi/margin-readiness';

function marginRow(overrides: Partial<{
  sourceRowNumber: number;
  contractDate: string;
  transactionType: string;
  securityCode: string | null;
  term: string;
  custodyType: string;
  quantity: string;
}> = {}) {
  return {
    sourceRowNumber: 6,
    contractDate: '2026-01-01',
    transactionType: '信用返済売',
    securityCode: '0000',
    term: '6ヶ月',
    custodyType: '特定',
    quantity: '10',
    ...overrides,
  };
}

describe('SBI margin history readiness', () => {
  it('requires opening-position information when a close has no earlier open', () => {
    expect(assessSbiMarginHistory([marginRow()])).toEqual({
      marginRows: 1,
      historyCoverage: 'needs-opening-position',
      endingOpenPositions: 'unknown',
    });
  });

  it('matches same-day opens and closes without depending on CSV row order', () => {
    const rows = [
      marginRow({ sourceRowNumber: 6, transactionType: '信用返済売', quantity: '10' }),
      marginRow({ sourceRowNumber: 7, transactionType: '信用新規買', quantity: '10' }),
    ];
    expect(assessSbiMarginHistory(rows)).toEqual({
      marginRows: 2,
      historyCoverage: 'complete',
      endingOpenPositions: 'none',
    });
  });

  it('reports an ending open position without exposing its quantity', () => {
    const result = assessSbiMarginHistory([
      marginRow({ transactionType: '信用新規買', quantity: '10.5' }),
      marginRow({ sourceRowNumber: 7, contractDate: '2026-01-02', transactionType: '信用返済売', quantity: '4.25' }),
    ]);
    expect(result).toEqual({
      marginRows: 2,
      historyCoverage: 'complete',
      endingOpenPositions: 'present',
    });
    expect(JSON.stringify(result)).not.toContain('10.5');
    expect(JSON.stringify(result)).not.toContain('4.25');
    expect(JSON.stringify(result)).not.toContain('0000');
  });
  it('tracks short closes and delivery against their corresponding side', () => {
    const rows = [
      marginRow({ sourceRowNumber: 6, transactionType: '信用新規売', quantity: '3' }),
      marginRow({ sourceRowNumber: 7, contractDate: '2026-01-02', transactionType: '信用返済買', quantity: '3' }),
      marginRow({ sourceRowNumber: 8, contractDate: '2026-01-03', transactionType: '信用新規買', quantity: '5' }),
      marginRow({ sourceRowNumber: 9, contractDate: '2026-01-04', transactionType: '現引', quantity: '5' }),
    ];
    expect(assessSbiMarginHistory(rows)).toMatchObject({
      historyCoverage: 'complete',
      endingOpenPositions: 'none',
    });
  });

  it.each([
    { securityCode: null },
    { quantity: '0' },
    { quantity: '-1' },
  ])('fails closed when a margin row cannot be matched safely: %s', (overrides) => {
    expect(assessSbiMarginHistory([marginRow({ transactionType: '信用新規買', ...overrides })])).toEqual({
      marginRows: 1,
      historyCoverage: 'needs-row-review',
      endingOpenPositions: 'unknown',
    });
  });

  it('fails closed before converting an excessively long quantity to BigInt', () => {
    const result = assessSbiMarginHistory([
      marginRow({ transactionType: '信用新規買', quantity: '1'.repeat(65) }),
    ]);
    expect(result.historyCoverage).toBe('needs-row-review');
  });

});
