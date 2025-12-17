'use client';

import { useState, useEffect } from 'react';

export default function ActiveFiles() {
  const [activeFiles, setActiveFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchActiveFiles = async () => {
    try {
      setError(null);
      setLoading(true);
      
      const response = await fetch('/api/active-files');
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setActiveFiles(data.files || []);
      } else {
        throw new Error(data.error || 'Failed to fetch active files');
      }
    } catch (error) {
      console.error('Failed to fetch active files:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActiveFiles();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchActiveFiles, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleResume = async (fileId) => {
    try {
      const response = await fetch('/api/resume-processing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert(`✅ Processing resumed for File ${fileId}`);
        fetchActiveFiles();
      } else {
        alert(`❌ Failed to resume: ${data.error}`);
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    }
  };

  const handleCancel = async (fileId) => {
    if (!confirm('Are you sure you want to cancel this file?')) return;
    
    try {
      const response = await fetch('/api/cancel-processing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId })
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert(`✅ Processing cancelled for File ${fileId}`);
        fetchActiveFiles();
      } else {
        alert(`❌ Failed to cancel: ${data.error}`);
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    }
  };

  // Show loading state
  if (loading && activeFiles.length === 0) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>🔄 Active Processing</h3>
        <div style={styles.loading}>
          <div style={styles.spinner}></div>
          <span>Loading active files...</span>
        </div>
      </div>
    );
  }

  // Show error state with retry
  if (error && activeFiles.length === 0) {
    return (
      <div style={styles.container}>
        <h3 style={styles.title}>🔄 Active Processing</h3>
        <div style={styles.errorBox}>
          <div style={styles.errorIcon}>⚠️</div>
          <div style={styles.errorText}>
            Could not load active files: {error}
          </div>
          <button 
            onClick={fetchActiveFiles} 
            style={styles.retryButton}
          >
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  // Don't show if no active files
  if (activeFiles.length === 0) {
    return null;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>🔄 Active Processing</h3>
        {error && (
          <span style={styles.errorBadge} title={error}>
            ⚠️ Update failed
          </span>
        )}
      </div>
      
      {activeFiles.map(file => {
        const progress = parseFloat(file.processing_progress) || 0;
        const isProcessing = file.processing_status === 'processing';
        const canResume = file.can_resume && progress < 100;
        
        return (
          <div key={file.id} style={styles.fileCard}>
            <div style={styles.fileHeader}>
              <div>
                <div style={styles.fileName}>{file.file_name || 'Unknown File'}</div>
                <div style={styles.fileInfo}>
                  File ID: {file.id} • {(file.processing_total || 0).toLocaleString()} records
                </div>
              </div>
              
              <div style={styles.status}>
                {isProcessing ? '🔄 Processing' : '⏸️ Paused'}
              </div>
            </div>
            
            <div style={styles.progressBar}>
              <div 
                style={{
                  ...styles.progressFill,
                  width: `${Math.min(100, Math.max(0, progress))}%`,
                  background: isProcessing 
                    ? 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
                    : 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)'
                }}
              />
            </div>
            
            <div style={styles.progressText}>
              {(file.processing_offset || 0).toLocaleString()} / {(file.processing_total || 0).toLocaleString()} ({progress.toFixed(1)}%)
            </div>
            
            <div style={styles.actions}>
              {canResume && !isProcessing && (
                <button 
                  onClick={() => handleResume(file.id)}
                  style={styles.resumeButton}
                >
                  ▶️ Resume
                </button>
              )}
              
              {isProcessing && (
                <div style={styles.processingNote}>
                  ⚡ Processing automatically...
                </div>
              )}
              
              <button 
                onClick={() => handleCancel(file.id)}
                style={styles.cancelButton}
              >
                ❌ Cancel
              </button>
            </div>
          </div>
        );
      })}
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
  errorBadge: {
    padding: '4px 12px',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'help',
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
    transition: 'all 0.2s',
  },
  fileCard: {
    background: 'white',
    padding: '20px',
    borderRadius: '10px',
    marginBottom: '15px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  fileHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '15px',
  },
  fileName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '5px',
  },
  fileInfo: {
    fontSize: '12px',
    color: '#6b7280',
  },
  status: {
    fontSize: '14px',
    fontWeight: '600',
    padding: '5px 12px',
    borderRadius: '20px',
    background: '#e0e0e0',
    whiteSpace: 'nowrap',
  },
  progressBar: {
    height: '8px',
    background: '#e0e0e0',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: '4px',
  },
  progressText: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '15px',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  resumeButton: {
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
  },
  cancelButton: {
    padding: '8px 16px',
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
  },
  processingNote: {
    fontSize: '14px',
    color: '#667eea',
    fontWeight: '600',
  },
};