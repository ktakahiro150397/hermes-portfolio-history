'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { buildSbiImportPreview, type SbiImportPreview } from '@/import/sbi/import-preview';
import {
  assessSbiMarginHistory,
  type SbiMarginHistoryAssessment,
} from '@/import/sbi/margin-readiness';
import { parseSbiTradeHistory } from '@/import/sbi/trade-history';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.startsWith('SBI約定履歴CSV')) {
    return error.message;
  }
  return 'CSVを確認できませんでした。SBIの約定履歴CSVを選び直してください。';
}

export default function SbiImportClient() {
  const operationVersion = useRef(0);
  const [preview, setPreview] = useState<SbiImportPreview | null>(null);
  const [marginAssessment, setMarginAssessment] = useState<SbiMarginHistoryAssessment | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const version = ++operationVersion.current;
    const file = event.currentTarget.files?.[0];
    setPreview(null);
    setMarginAssessment(null);
    setError('');
    setStatus('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('CSVは10 MB以下のファイルを選んでください。');
      return;
    }
    setStatus('CSVを確認しています…');
    try {
      const buffer = await file.arrayBuffer();
      if (version !== operationVersion.current) return;
      const parsed = parseSbiTradeHistory(new Uint8Array(buffer));
      const nextPreview = buildSbiImportPreview(parsed.rows);
      const nextMarginAssessment = assessSbiMarginHistory(parsed.rows);
      if (version !== operationVersion.current) return;
      setPreview(nextPreview);
      setMarginAssessment(nextMarginAssessment);
      setStatus(`取引 ${nextPreview.totalRows}件`);
    } catch (caught) {
      if (version !== operationVersion.current) return;
      setError(safeErrorMessage(caught));
      setStatus('');
    }
  }

  return (
    <>
      <div className="import-file-panel">
        <label htmlFor="sbi-trade-csv">SBI約定履歴CSV</label>
        <input id="sbi-trade-csv" type="file" accept=".csv,text/csv" onChange={handleFileChange} />
        <strong>CSVは外部へ送信されません</strong>
        <p>このbrowser内で形式と取引種類を確認します。現段階では保存もしません。</p>
      </div>

      {status ? <p className="import-live-status" role="status">{status}</p> : null}
      {error ? <div className="import-error" role="alert">{error}</div> : null}

      {preview ? (
        <section className="actual-import-preview" aria-labelledby="actual-preview-title">
          <h2 id="actual-preview-title">分類結果</h2>
          <div className="import-summary" aria-label="取引の分類結果">
            <article className="summary-box summary-ready">
              <span>現物株・通常の投資信託</span>
              <strong>自動計上候補 {preview.supportCounts.ready}件</strong>
            </article>
            <article className="summary-box summary-waiting">
              <span>信用取引・現引</span>
              <strong>信用対応待ち {preview.supportCounts['needs-margin-ledger']}件</strong>
            </article>
            <article className="summary-box summary-waiting">
              <span>分配金再投資</span>
              <strong>分配詳細待ち {preview.supportCounts['needs-distribution-details']}件</strong>
            </article>
            <article className="summary-box summary-review">
              <span>新しい取引種類</span>
              <strong>種類の確認待ち {preview.supportCounts['needs-review']}件</strong>
            </article>
          </div>
          {marginAssessment && marginAssessment.marginRows > 0 ? (
            <section className="margin-readiness" aria-labelledby="margin-readiness-title">
              <h3 id="margin-readiness-title">信用取引の履歴確認</h3>
              {marginAssessment.historyCoverage === 'needs-opening-position' ? (
                <>
                  <strong>開始時点の建玉情報が必要です</strong>
                  <p>このCSVより前から続く建玉があるため、信用損益はまだ確定しません。</p>
                </>
              ) : marginAssessment.historyCoverage === 'needs-row-review' ? (
                <>
                  <strong>対応関係を確認できない信用取引があります</strong>
                  <p>数量や銘柄は表示せず、確認が必要な状態だけを案内しています。</p>
                </>
              ) : marginAssessment.endingOpenPositions === 'present' ? (
                <>
                  <strong>CSV内の新規・返済関係を確認できました</strong>
                  <p>末日時点に未決済の建玉があるため、現在残高との照合が必要です。</p>
                </>
              ) : (
                <>
                  <strong>CSV内の新規・返済関係を確認できました</strong>
                  <p>末日時点の未決済建玉は、このCSV内では確認されませんでした。</p>
                </>
              )}
            </section>
          ) : null}
          {preview.totalRows === 0 ? (
            <div className="import-warning" role="alert">
              <strong>CSVに取引がありません</strong>
              <p>期間を確認して、取引を含むSBI約定履歴CSVを選んでください。</p>
            </div>
          ) : preview.hasDeferredRows ? (
            <div className="import-warning" role="alert">
              <strong>未反映の取引が {preview.deferredRows}件あります</strong>
              <p>対応が完成するまで、総資産を確定表示しません。</p>
            </div>
          ) : (
            <p className="import-ready-message">すべて自動計上候補として確認できました。</p>
          )}
          <button className="import-confirm" type="button" disabled>取込を確定（まだ利用できません）</button>
        </section>
      ) : null}
    </>
  );
}
