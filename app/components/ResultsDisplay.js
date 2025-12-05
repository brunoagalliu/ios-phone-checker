'use client';

import Papa from 'papaparse';

export default function ResultsDisplay({ results, fileName }) {
  if (!results || results.length === 0) return null;

  const downloadResults = () => {
    const csv = Papa.unparse(results.map(r => ({
      original_number: r.original_number || r.phone_number,
      formatted_number: r.formatted_number || r.phone_number,
      display_number: r.display_number || r.phone_number,
      is_ios: r.is_ios ? 'YES' : 'NO',
      supports_imessage: r.supports_imessage ? 'YES' : 'NO',
      supports_sms: r.supports_sms ? 'YES' : 'NO',
      from_cache: r.from_cache ? 'YES' : 'NO',
      cache_age_days: r.cache_age_days || 'N/A',
      error: r.error || 'None',
      checked_at: new Date().toISOString()
    })));

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace('.csv', '')}_results_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const cacheHits = results.filter(r => r.from_cache).length;

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>✅ Processing Complete!</h3>
      
      {cacheHits > 0 && (
        <div style={styles.cacheInfo}>
          <strong>💾 Cache Performance</strong>
          <div style={{marginTop: '10px', fontSize: '13px'}}>
            ✅ {cacheHits} numbers from cache<br/>
            🚀 {cacheHits} API calls saved<br/>
            💰 Cost saved: ${(cacheHits * 0.01).toFixed(2)}
          </div>
        </div>
      )}
      
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{results.length}</div>
          <div style={styles.statLabel}>Checked</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statNumber, color: '#007aff' }}>
            {results.filter(r => r.is_ios).length}
          </div>
          <div style={styles.statLabel}>iOS Users</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statNumber, color: '#17a2b8' }}>
            {cacheHits}
          </div>
          <div style={styles.statLabel}>From Cache</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statNumber, color: '#dc3545' }}>
            {results.filter(r => r.error).length}
          </div>
          <div style={styles.statLabel}>Errors</div>
        </div>
      </div>

      <button onClick={downloadResults} style={styles.downloadButton}>
        ⬇️ Download Results CSV
      </button>

      <div style={styles.previewSection}>
        <h4 style={{ marginBottom: '15px' }}>Preview (first 10 results)</h4>
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Original</th>
                <th style={styles.th}>Formatted</th>
                <th style={styles.th}>iOS</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {results.slice(0, 10).map((result, index) => (
                <tr key={index} style={index % 2 === 0 ? styles.trEven : styles.trOdd}>
                  <td style={styles.td}>{result.original_number || result.phone_number}</td>
                  <td style={styles.td}>{result.formatted_number || result.phone_number}</td>
                  <td style={styles.td}>
                    <span style={result.is_ios ? styles.badgeIos : styles.badgeAndroid}>
                      {result.is_ios ? '✓ YES' : '✗ NO'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {result.from_cache ? (
                      <span style={styles.badgeCache}>Cache</span>
                    ) : result.error ? (
                      <span style={styles.badgeError}>Error</span>
                    ) : (
                      <span style={styles.badgeSuccess}>Success</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: '#d4edda',
    border: '2px solid #28a745',
    borderRadius: '10px',
    padding: '25px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '15px',
  },
  cacheInfo: {
    background: '#d1ecf1',
    border: '1px solid #17a2b8',
    borderRadius: '8px',
    padding: '15px',
    marginBottom: '20px',
    fontSize: '13px',
    color: '#0c5460',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    margin: '20px 0',
  },
  statCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
  },
  statNumber: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  statLabel: {
    fontSize: '13px',
    color: '#666',
  },
  downloadButton: {
    width: '100%',
    padding: '14px 24px',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    background: '#28a745',
    color: 'white',
    marginBottom: '20px',
  },
  previewSection: {
    marginTop: '20px',
  },
  tableContainer: {
    overflowX: 'auto',
    border: '1px solid #ddd',
    borderRadius: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    background: '#f8f9fa',
    padding: '12px',
    textAlign: 'left',
    fontWeight: '600',
    borderBottom: '2px solid #dee2e6',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #dee2e6',
  },
  trEven: {
    background: 'white',
  },
  trOdd: {
    background: '#f8f9fa',
  },
  badgeIos: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#007aff',
    color: 'white',
  },
  badgeAndroid: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#6c757d',
    color: 'white',
  },
  badgeSuccess: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#28a745',
    color: 'white',
  },
  badgeError: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#dc3545',
    color: 'white',
  },
  badgeCache: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#17a2b8',
    color: 'white',
  },
};