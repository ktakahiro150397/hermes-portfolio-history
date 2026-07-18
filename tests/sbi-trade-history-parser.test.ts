import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSbiTradeHistory } from '@/import/sbi/trade-history';

const fixturePath = resolve(process.cwd(), 'tests/fixtures/sbi/trade-history.shift-jis.synthetic.csv');

describe('SBI trade history parser', () => {
  it('parses the approved Shift_JIS 14-column fixture with a fifth-row header', async () => {
    const result = parseSbiTradeHistory(await readFile(fixturePath));

    expect(result.metadata).toEqual({ encoding: 'shift_jis', headerRowNumber: 5 });
    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toEqual({
      sourceRowNumber: 6,
      contractDate: '2000-01-01',
      securityName: '[文字列]',
      securityCode: null,
      market: null,
      transactionType: '[文字列]',
      term: '[文字列]',
      custodyType: '[文字列]',
      taxationType: '[文字列]',
      quantity: '1000',
      unitPrice: '1000',
      feesOrExpenses: null,
      feesOrExpensesRaw: '[文字列]',
      taxAmount: null,
      taxAmountRaw: '[文字列]',
      settlementDate: '2000-01-01',
      settlementAmountOrProfitLoss: '1000',
      settlementAmountOrProfitLossRaw: '1000',
    });
  });

  it('handles quoted commas and newlines without shifting columns', () => {
    const csv = [
      '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益',
      '2026/07/01,"安全な,\n合成銘柄",0000,東証,現物買,当日,特定,課税,10,"1,234.5",100,20,2026/07/03,"12,345"',
    ].join('\r\n');

    const [row] = parseSbiTradeHistory(new TextEncoder().encode(csv)).rows;
    expect(row.securityName).toBe('安全な,\n合成銘柄');
    expect(row.securityCode).toBe('0000');
    expect(row.unitPrice).toBe('1234.5');
    expect(row.settlementAmountOrProfitLoss).toBe('12345');
  });

  it('rejects malformed quotes', () => {
    const malformed = new TextEncoder().encode('約定日,銘柄\n"2000/01/01,閉じていない');
    expect(() => parseSbiTradeHistory(malformed)).toThrow('引用符');
  });

  it('rejects an unknown schema without including source values in the error', () => {
    const secret = 'SHOULD_NOT_APPEAR';
    expect(() => parseSbiTradeHistory(new TextEncoder().encode(`別形式,${secret}\n1,2`))).toThrow('14列の見出し');
    try { parseSbiTradeHistory(new TextEncoder().encode(`別形式,${secret}\n1,2`)); }
    catch (error) { expect(String(error)).not.toContain(secret); }
  });

  it('reports the row and column for invalid required numbers without echoing the value', () => {
    const secret = 'PRIVATE_NUMBER';
    const csv = [
      '約定日,銘柄,銘柄コード,市場,取引,期限,預り,課税,約定数量,約定単価,手数料/諸経費等,税額,受渡日,受渡金額/決済損益',
      `2000/01/01,合成,0000,東証,現物買,当日,特定,課税,${secret},1000,--,--,2000/01/03,10000`,
    ].join('\n');
    try { parseSbiTradeHistory(new TextEncoder().encode(csv)); throw new Error('expected parser failure'); }
    catch (error) {
      expect(String(error)).toContain('2行目');
      expect(String(error)).toContain('約定数量');
      expect(String(error)).not.toContain(secret);
    }
  });
});
