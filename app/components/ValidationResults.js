'use client';

export default function ValidationResults({ results }) {
  if (!results) return null;

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>📊 Validation Results</h3>
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{results.total}</div>
          <div style={styles.statLabel}>Total Uploaded</div>
        </div>
        <div style={{ ...styles.statCard, background: '#d4edda' }}>
          <div style={{ ...styles.statNumber, color: '#28a745' }}>
            {results.valid}
          </div>
          <div style={styles.statLabel}>✓ Valid US Numbers</div>
        </div>
        <div style={{ ...styles.statCard, background: '#f8d7da' }}>
          <div style={{ ...styles.statNumber, color: '#dc3545' }}>
            {results.invalid}
          </div>
          <div style={styles.statLabel}>✗ Invalid</div>
        </div>
        <div style={{ ...styles.statCard, background: '#fff3cd' }}>
          <div style={{ ...styles.statNumber, color: '#856404' }}>
            {results.duplicates}
          </div>
          <div style={styles.statLabel}>⚠ Duplicates</div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: '#e7f3ff',
    border: '2px solid #17a2b8',
    borderRadius: '10px',
    padding: '25px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '15px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
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
};