'use client';

export default function ActiveFiles({ files, isLoading }) {
  if (isLoading) {
    return (
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>⚙️ Active Processing</h2>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>⚙️ Active Processing</h2>
        <div style={styles.emptyState}>No files currently processing</div>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>⚙️ Active Processing</h2>
      <div style={styles.fileList}>
        {files.map(file => (
          <div key={file.id} style={styles.fileCard}>
            <div style={styles.fileHeader}>
              <span style={styles.fileName}>📄 {file.file_name}</span>
              <span style={{...styles.badge, ...styles.processingBadge}}>
                {file.processing_status}
              </span>
            </div>
            <div style={styles.progressBar}>
              <div 
                style={{
                  ...styles.progressFill,
                  width: `${file.processing_progress}%`
                }}
              />
            </div>
            <div style={styles.fileStats}>
              <span>{file.processing_offset?.toLocaleString()} / {file.processing_total?.toLocaleString()}</span>
              <span>{file.processing_progress}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  section: {
    marginBottom: '30px',
  },
  sectionTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '15px',
  },
  loading: {
    padding: '20px',
    textAlign: 'center',
    color: '#666',
  },
  emptyState: {
    padding: '30px',
    textAlign: 'center',
    color: '#999',
    background: '#f9fafb',
    borderRadius: '12px',
  },
  fileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  fileCard: {
    background: '#f9fafb',
    padding: '20px',
    borderRadius: '12px',
    border: '2px solid #e5e7eb',
  },
  fileHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
  },
  fileName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
  },
  badge: {
    padding: '4px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
  },
  processingBadge: {
    background: '#dbeafe',
    color: '#1e40af',
  },
  progressBar: {
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '10px',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
    transition: 'width 0.3s ease',
  },
  fileStats: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    color: '#666',
  },
};