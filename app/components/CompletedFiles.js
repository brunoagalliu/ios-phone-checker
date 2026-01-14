'use client';

export default function CompletedFiles({ files, isLoading }) {
  if (isLoading) {
    return (
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>✅ Completed Files</h2>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>✅ Completed Files</h2>
        <div style={styles.emptyState}>No completed files yet</div>
      </div>
    );
  }

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>✅ Completed Files</h2>
      <div style={styles.fileList}>
        {files.map(file => (
          <div key={file.id} style={styles.fileCard}>
            <div style={styles.fileHeader}>
              <span style={styles.fileName}>📄 {file.file_name}</span>
              <span style={{...styles.badge, ...styles.completedBadge}}>
                Completed
              </span>
            </div>
            <div style={styles.fileStats}>
              <span>{file.processing_total?.toLocaleString()} phones processed</span>
              {file.results_file_url && (
                <a 
                  href={file.results_file_url} 
                  download
                  style={styles.downloadButton}
                >
                  ⬇️ Download
                </a>
              )}
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
  completedBadge: {
    background: '#d1fae5',
    color: '#065f46',
  },
  fileStats: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '14px',
    color: '#666',
  },
  downloadButton: {
    padding: '8px 16px',
    background: '#667eea',
    color: 'white',
    borderRadius: '8px',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: '600',
  },
};