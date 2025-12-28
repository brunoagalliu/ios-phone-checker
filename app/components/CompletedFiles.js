'use client';

import { useState, useEffect, useCallback } from 'react';

export default function CompletedFiles() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchCompletedFiles = useCallback(async () => {
    try {
      const response = await fetch('/api/completed-files');
      const data = await response.json();
      
      if (data.success && Array.isArray(data.files)) {
        setFiles(data.files);
      }
    } catch (error) {
      console.error('Failed to fetch completed files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompletedFiles();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchCompletedFiles, 30000);
    return () => clearInterval(interval);
  }, [fetchCompletedFiles]);

  const handleDownload = async (fileId, fileName) => {
    try {
      console.log(`Downloading file ${fileId}: ${fileName}`);
      
      const response = await fetch(`/api/download-results?fileId=${fileId}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Download failed');
      }
      
      // Get the blob
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `results_${fileName}`;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      console.log('✓ Download complete');
    } catch (error) {
      console.error('Download error:', error);
      alert(`Failed to download: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div style={styles.loading}>
        <div>🔄 Loading history...</div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={styles.empty}>
        <p>📋 No completed files yet. Upload a file to get started!</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>📋 Processing History</h3>
      
      <div style={styles.fileList}>
        {files.map(file => {
          if (!file || !file.id) return null;
          
          const uploadDate = new Date(file.upload_date).toLocaleString();
          
          return (
            <div key={file.id} style={styles.fileCard}>
              <div style={styles.fileHeader}>
                <div style={styles.fileInfo}>
                  <div style={styles.fileName}>
                    {file.file_name || 'Unknown File'}
                  </div>
                  <div style={styles.fileMeta}>
                    File ID: {file.id} • Uploaded: {uploadDate}
                  </div>
                  <div style={styles.fileMeta}>
                    Total Records: {(file.processing_total || 0).toLocaleString()}
                  </div>
                </div>
                
                <div style={styles.statusBadge}>
                  ✓ Completed
                </div>
              </div>
              
              <button
                onClick={() => handleDownload(file.id, file.file_name)}
                style={styles.downloadButton}
                onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
              >
                ⬇️ Download Results CSV
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  container: {
    marginTop: '30px',
  },
  title: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#333',
    marginBottom: '20px',
    marginTop: 0,
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#666',
    fontSize: '16px',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    background: '#f9fafb',
    borderRadius: '12px',
    color: '#666',
    fontSize: '16px',
    marginTop: '30px',
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
    transition: 'all 0.3s ease',
  },
  fileHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '15px',
    gap: '15px',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '8px',
    wordBreak: 'break-word',
  },
  fileMeta: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '4px',
  },
  statusBadge: {
    padding: '8px 16px',
    background: '#d1fae5',
    color: '#065f46',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
  },
  downloadButton: {
    width: '100%',
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    boxShadow: '0 2px 8px rgba(102, 126, 234, 0.3)',
  },
};