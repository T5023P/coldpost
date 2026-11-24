import { useEffect, useState } from 'react';
import { downloadCsv, useApi } from '../lib/api';
import { inr } from '../lib/format';
import { Btn, EmptyState, Loading, PageHead } from '../components/ui';

export function Reports() {
  const list = useApi<any>('/reports');
  const [selected, setSelected] = useState('orders-by-campaign');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    fetch(`/api/reports/${selected}?${params.toString()}`, { credentials: 'same-origin' })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? 'Report failed');
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selected, from, to]);

  const reports = list.data?.reports ?? [];
  const meta = reports.find((r: any) => r.key === selected);

  function exportCsv() {
    const params = new URLSearchParams({ format: 'csv' });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    downloadCsv(`/api/reports/${selected}?${params.toString()}`, `coldpost-${selected}.csv`);
  }

  function renderCell(column: any, value: any) {
    if (value === null || value === undefined) return '—';
    if (column.kind === 'currency') return inr(Number(value) * 100);
    if (column.kind === 'percent') return `${value}%`;
    return String(value);
  }

  return (
    <>
      <PageHead
        title="Reports"
        subtitle="Operational and financial reporting from the same data the studio works in. Export any view to CSV."
        actions={
          <>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 148 }} aria-label="From" />
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 148 }} aria-label="To" />
            <Btn onClick={exportCsv}>Export CSV</Btn>
          </>
        }
      />

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h3>{data?.title ?? meta?.title ?? 'Report'}</h3>
              <div className="actions">{loading ? <span className="spinner" /> : <span className="badge badge-outline">{data?.rows?.length ?? 0} rows</span>}</div>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {error ? <div className="alert alert-bad" style={{ margin: 16 }}>{error}</div> : null}
              {loading && !data ? <Loading /> : null}
              {data ? (
                <div className="table-wrap">
                  <table className="tbl">
                    <thead><tr>{data.columns.map((column: any) => <th key={column.key} className={['currency', 'number', 'percent'].includes(column.kind) ? 'num' : ''}>{column.label}</th>)}</tr></thead>
                    <tbody>
                      {data.rows.map((row: any, index: number) => (
                        <tr key={index}>
                          {data.columns.map((column: any) => (
                            <td key={column.key} className={['currency', 'number', 'percent'].includes(column.kind) ? 'num' : 'small'}>
                              {renderCell(column, row[column.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {!data.rows.length ? <tr><td colSpan={data.columns.length}><EmptyState title="No rows for this period" message="Adjust the date range or record more activity." /></td></tr> : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
            {data?.summary && Object.keys(data.summary).length ? (
              <div className="card-body" style={{ borderTop: '1px solid var(--line)' }}>
                <div className="row" style={{ gap: 22 }}>
                  {Object.entries(data.summary).map(([key, value]) => (
                    <div key={key}>
                      <div className="tag">{key.replace(/_/g, ' ')}</div>
                      <strong style={{ fontSize: 16 }}>{typeof value === 'number' ? value.toLocaleString('en-IN') : String(value)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="hint-box">
            {meta?.description ?? 'Choose a report from the list.'} Reports read live data; currency values are shown in INR.
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Report library</h3></div>
          <div className="card-body stack-sm">
            {reports.map((report: any) => (
              <button
                key={report.key}
                onClick={() => setSelected(report.key)}
                style={{
                  textAlign: 'left',
                  border: '1px solid',
                  borderColor: selected === report.key ? 'var(--ink)' : 'var(--line)',
                  background: selected === report.key ? 'var(--ink)' : '#fffdf9',
                  color: selected === report.key ? '#fbf7ef' : 'var(--ink)',
                  padding: '10px 12px',
                  borderRadius: 9,
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{report.title}</div>
                <div style={{ fontSize: 11, opacity: selected === report.key ? 0.7 : 0.75, marginTop: 2 }}>{report.description}</div>
              </button>
            ))}
            {!reports.length ? <EmptyState title="No reports available" /> : null}
          </div>
        </div>
      </div>
    </>
  );
}
