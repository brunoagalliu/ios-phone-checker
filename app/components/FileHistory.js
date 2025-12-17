'use client';

import { useState, useEffect } from 'react';

export default function FileHistory() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchFiles = async () => {
    try {
      setError(null);
      
      const response = await fetch('/api/files');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setFiles(data.files || []);
      } else {
        throw new Error(data.error || 'Failed to load file history');
      }
    } catch (error) {
      console.error('Failed to load file history:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleDownload = (fileUrl, fileName) => {
    if (!fileUrl) {
      alert('❌ No download URL available');
      return;
    }

    // Create temporary link and trigger download
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName || 'results.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>📂 File History</h3>
        <div style={styles.loading}>
          <div style={styles.spinner}></div>
          <span>Loading file history...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>📂 File History</h3>
        <div style={styles.errorBox}>
          <div style={styles.errorIcon}>⚠️</div>
          <div style={styles.errorText}>
            {error}
          </div>
          <button 
            onClick={fetchFiles} 
            style={styles.retryButton}
          >
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>📂 File History</h3>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📭</div>
          <div style={styles.emptyText}>No files uploaded yet</div>
          <div style={styles.emptyHint}>Upload a CSV file to get started</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>📂 File History</h3>
        <button onClick={fetchFiles} style={styles.refreshButton}>
          🔄 Refresh
        </button>
      </div>

      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeader}>
              <th style={styles.th}>File Name</th>
              <th style={styles.th}>Upload Date</th>
              <th style={styles.th}>Total</th>
              <th style={styles.th}>Valid</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Progress</th>
              <th style={styles.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map(file => (
              <tr key={file.id} style={styles.tableRow}>
                <td style={styles.td}>
                  <div style={styles.fileName}>{file.file_name || file.original_name}</div>
                  <div style={styles.fileId}>ID: {file.id}</div>
                </td>
                <td style={styles.td}>
                  {file.upload_date ? new Date(file.upload_date).toLocaleString() : 'N/A'}
                </td>
                <td style={styles.td}>
                  {(file.total_numbers || 0).toLocaleString()}
                </td>
                <td style={styles.td}>
                  {(file.valid_numbers || 0).toLocaleString()}
                </td>
                <td style={styles.td}>
                  <span style={{
                    ...styles.statusBadge,
                    background: file.processing_status === 'completed' ? '#d1fae5' :
                                file.processing_status === 'processing' ? '#dbeafe' :
                                file.processing_status === 'failed' ? '#fee2e2' : '#f3f4f6',
                    color: file.processing_status === 'completed' ? '#065f46' :
                           file.processing_status === 'processing' ? '#1e40af' :
                           file.processing_status === 'failed' ? '#991b1b' : '#4b5563'
                  }}>
                    {file.processing_status || 'uploaded'}
                  </span>
                </td>
                <td style={styles.td}>
                  {file.processing_progress ? `${parseFloat(file.processing_progress).toFixed(1)}%` : 'N/A'}
                </td>
                <td style={styles.td}>
                  {file.results_file_url ? (
                    <button
                      onClick={() => handleDownload(file.results_file_url, `results_${file.file_name}`)}
                      style={styles.downloadButton}
                    >
                      ⬇️ Download
                    </button>
                  ) : (
                    <span style={styles.noDownload}>No results</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: '#f8f9fa',
    padding: '20px',
    borderRadius: '15px',
    marginBottom: '30px',
    border: '2px solid #e0e0e0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#333',
    margin: 0,
  },
  refreshButton: {
    padding: '8px 16px',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    gap: '15px',
    color: '#6b7280',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e0e0e0',
    borderTop: '4px solid #667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '15px',
    padding: '30px',
    background: '#fee2e2',
    border: '2px solid #fecaca',
    borderRadius: '10px',
  },
  errorIcon: {
    fontSize: '48px',
  },
  errorText: {
    fontSize: '14px',
    color: '#991b1b',
    textAlign: 'center',
    fontWeight: '500',
  },
  retryButton: {
    padding: '10px 20px',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '60px 20px',
    gap: '10px',
  },
  emptyIcon: {
    fontSize: '64px',
    opacity: 0.5,
  },
  emptyText: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#6b7280',
  },
  emptyHint: {
    fontSize: '14px',
    color: '#9ca3af',
  },
  tableContainer: {
    overflowX: 'auto',
    background: 'white',
    borderRadius: '10px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  tableHeader: {
    background: '#f9fafb',
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    borderBottom: '2px solid #e5e7eb',
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
    transition: 'background 0.2s',
  },
  td: {
    padding: '12px 16px',
    fontSize: '14px',
    color: '#1f2937',
  },
  fileName: {
    fontWeight: '600',
    marginBottom: '2px',
  },
  fileId: {
    fontSize: '12px',
    color: '#6b7280',
  },
  statusBadge: {
    padding: '4px 10px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
    display: 'inline-block',
  },
  downloadButton: {
    padding: '6px 12px',
    background: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  noDownload: {
    fontSize: '13px',
    color: '#9ca3af',
    fontStyle: 'italic',
  },
};