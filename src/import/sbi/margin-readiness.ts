export interface SbiMarginReadinessSourceRow {
  sourceRowNumber: number;
  contractDate: string;
  transactionType: string;
  securityCode: string | null;
  term: string;
  custodyType: string;
  quantity: string;
}

export interface SbiMarginHistoryAssessment {
  marginRows: number;
  historyCoverage: 'complete' | 'needs-opening-position' | 'needs-row-review';
  endingOpenPositions: 'present' | 'none' | 'unknown';
}

type MarginSide = 'long' | 'short';
type MarginAction = { side: MarginSide; direction: 'open' | 'close' };
type DecimalValue = { units: bigint; scale: number };
type DailyChange = { opened: DecimalValue; closed: DecimalValue };

const MARGIN_ACTIONS: Readonly<Record<string, MarginAction>> = {
  現引: { side: 'long', direction: 'close' },
  信用新規買: { side: 'long', direction: 'open' },
  信用新規売: { side: 'short', direction: 'open' },
  信用返済買: { side: 'short', direction: 'close' },
  信用返済売: { side: 'long', direction: 'close' },
};
const ZERO: DecimalValue = { units: 0n, scale: 0 };

function positiveDecimal(value: string): DecimalValue | null {
  if (value.length > 64) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? '';
  const parsed = { units: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
  return parsed.units > 0n ? parsed : null;
}

function add(left: DecimalValue, right: DecimalValue, sign: 1n | -1n = 1n): DecimalValue {
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = left.units * 10n ** BigInt(scale - left.scale);
  const rightUnits = right.units * 10n ** BigInt(scale - right.scale);
  return { units: leftUnits + sign * rightUnits, scale };
}

export function assessSbiMarginHistory(
  sourceRows: SbiMarginReadinessSourceRow[],
): SbiMarginHistoryAssessment {
  const marginRows = sourceRows.filter((row) => Object.hasOwn(MARGIN_ACTIONS, row.transactionType));
  if (marginRows.length === 0) {
    return { marginRows: 0, historyCoverage: 'complete', endingOpenPositions: 'none' };
  }

  const byDate = new Map<string, Map<string, DailyChange>>();
  for (const row of marginRows) {
    const action = MARGIN_ACTIONS[row.transactionType];
    const quantity = positiveDecimal(row.quantity);
    if (!row.securityCode || !quantity) {
      return {
        marginRows: marginRows.length,
        historyCoverage: 'needs-row-review',
        endingOpenPositions: 'unknown',
      };
    }
    const key = JSON.stringify([row.securityCode, row.term, row.custodyType, action.side]);
    const daily = byDate.get(row.contractDate) ?? new Map<string, DailyChange>();
    const change = daily.get(key) ?? { opened: ZERO, closed: ZERO };
    change[action.direction === 'open' ? 'opened' : 'closed'] = add(
      change[action.direction === 'open' ? 'opened' : 'closed'],
      quantity,
    );
    daily.set(key, change);
    byDate.set(row.contractDate, daily);
  }

  const balances = new Map<string, DecimalValue>();
  let needsOpeningPosition = false;
  for (const date of [...byDate.keys()].sort()) {
    for (const [key, change] of byDate.get(date)!) {
      const afterOpen = add(balances.get(key) ?? ZERO, change.opened);
      const afterClose = add(afterOpen, change.closed, -1n);
      if (afterClose.units < 0n) {
        needsOpeningPosition = true;
        balances.set(key, ZERO);
      } else {
        balances.set(key, afterClose);
      }
    }
  }

  if (needsOpeningPosition) {
    return {
      marginRows: marginRows.length,
      historyCoverage: 'needs-opening-position',
      endingOpenPositions: 'unknown',
    };
  }
  const hasEndingPosition = [...balances.values()].some((balance) => balance.units > 0n);
  return {
    marginRows: marginRows.length,
    historyCoverage: 'complete',
    endingOpenPositions: hasEndingPosition ? 'present' : 'none',
  };
}
