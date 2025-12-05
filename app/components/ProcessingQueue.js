'use client';

export default function ProcessingQueue({ files }) {
  if (files.length === 0) return null;

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>📊 Processing Queue</h3>
      {files.map((file) => (
        <FileProcessingItem key={file.id} file={file} />
      ))}
    </div>
  );
}

function FileProcessingItem({ file }) {
  const getStatusColor = () => {
    switch (file.status) {
      case 'completed': return '#28a745';
      case 'processing': return '#17a2b8';
      case 'error': return '#dc3545';
      case 'queued': return '#ffc107';
      default: return '#6c757d';
    }
  };

  const getStatusIcon = () => {
    switch (file.status) {
      case 'completed': return '✅';
      case 'processing': return '⏳';
      case 'error': return '❌';
      case 'queued': return '⏸️';
      default: return '📄';
    }
  };

  return (
    <div style={styles.fileItem}>
      <div style={styles.fileHeader}>
        <div style={styles.fileInfo}>
          <span style={styles.fileIcon}>{getStatusIcon()}</span>
          <div>
            <div style={styles.fileName}>{file.name}</div>
            <div style={styles.fileStats}>
              {file.totalNumbers > 0 && (
                <>
                  Total: {file.totalNumbers} • 
                  Valid: {file.validNumbers} • 
                  Processed: {file.processedCount || 0}
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ ...styles.statusBadge, background: getStatusColor() }}>
          {file.status}
        </div>
      </div>

      {file.status === 'processing' && file.totalNumbers > 0 && (
        <>
          <div style={styles.progressContainer}>
            <div style={styles.progressBar}>
              <div
                style={{
                  ...styles.progressFill,
                  width: `${(file.processedCount / file.validNumbers) * 100}%`,
                }}
              />
            </div>
            <div style={styles.progressText}>
              {file.processedCount} / {file.validNumbers} 
              ({Math.round((file.processedCount / file.validNumbers) * 100)}%)
            </div>
          </div>
          <div style={styles.rateLimitInfo}>
            ⏱️ Rate limited: 4 requests/second (250ms between requests)
          </div>
        </>
      )}

      {file.validationResults && (
        <div style={styles.validationSummary}>
          <span style={styles.validBadge}>✓ {file.validationResults.valid} valid</span>
          <span style={styles.invalidBadge}>✗ {file.validationResults.invalid} invalid</span>
          <span style={styles.dupBadge}>⚠ {file.validationResults.duplicates} duplicates</span>
        </div>
      )}

      {file.error && (
        <div style={styles.errorMessage}>
          Error: {file.error}
        </div>
      )}

      {file.status === 'completed' && file.results && (
        <div style={styles.completionInfo}>
          <div style={styles.completionStats}>
            <span style={styles.completionStat}>
              📊 {file.results.length} checked
            </span>
            <span style={styles.completionStat}>
              📱 {file.results.filter(r => r.is_ios).length} iOS
            </span>
            <span style={styles.completionStat}>
              💾 {file.results.filter(r => r.from_cache).length} cached
            </span>
            {file.results.filter(r => r.error).length > 0 && (
              <span style={styles.completionStat}>
                ⚠️ {file.results.filter(r => r.error).length} errors
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    background: '#f8f9fa',
    borderRadius: '10px',
    padding: '20px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '15px',
    color: '#333',
  },
  fileItem: {
    background: 'white',
    borderRadius: '8px',
    padding: '15px',
    marginBottom: '10px',
    border: '1px solid #dee2e6',
  },
  fileHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flex: 1,
  },
  fileIcon: {
    fontSize: '24px',
  },
  fileName: {
    fontWeight: '600',
    color: '#333',
    fontSize: '14px',
  },
  fileStats: {
    fontSize: '12px',
    color: '#666',
    marginTop: '3px',
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'white',
    textTransform: 'capitalize',
  },
  progressContainer: {
    marginTop: '10px',
  },
  progressBar: {
    width: '100%',
    height: '8px',
    background: '#e9ecef',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '12px',
    color: '#666',
    marginTop: '5px',
    textAlign: 'right',
  },
  rateLimitInfo: {
    fontSize: '11px',
    color: '#666',
    marginTop: '8px',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '5px',
    background: '#fff3cd',
    borderRadius: '4px',
  },
  validationSummary: {
    display: 'flex',
    gap: '8px',
    marginTop: '10px',
    flexWrap: 'wrap',
  },
  validBadge: {
    padding: '3px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    background: '#d4edda',
    color: '#155724',
  },
  invalidBadge: {
    padding: '3px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    background: '#f8d7da',
    color: '#721c24',
  },
  dupBadge: {
    padding: '3px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    background: '#fff3cd',
    color: '#856404',
  },
  errorMessage: {
    marginTop: '10px',
    padding: '8px',
    background: '#f8d7da',
    color: '#721c24',
    borderRadius: '4px',
    fontSize: '12px',
  },
  completionInfo: {
    marginTop: '10px',
    padding: '10px',
    background: '#d4edda',
    borderRadius: '4px',
  },
  completionStats: {
    display: 'flex',
    gap: '12px',
    flexWrap: 'wrap',
    fontSize: '12px',
    color: '#155724',
  },
  completionStat: {
    fontWeight: '500',
  },
};