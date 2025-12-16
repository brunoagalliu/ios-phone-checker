'use client';

import { useState, useEffect } from 'react';

export default function ActiveFiles() {
  const [activeFiles, setActiveFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchActiveFiles = async () => {
    try {
      const response = await fetch('/api/active-files');
      const data = await response.json();
      
      if (data.success) {
        setActiveFiles(data.files);
      }
    } catch (error) {
      console.error('Failed to fetch active files:', error);
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
      }
    } catch (error) {
      alert(`❌ Error: ${error.message}`);
    }
  };

  if (loading) {
    return <div style={styles.loading}>Loading active files...</div>;
  }

  if (activeFiles.length === 0) {
    return null; // Don't show if no active files
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🔄 Active Processing</h3>
      
      {activeFiles.map(file => {
        const progress = parseFloat(file.processing_progress) || 0;
        const isProcessing = file.processing_status === 'processing';
        const canResume = file.can_resume && progress < 100;
        
        return (
          <div key={file.id} style={styles.fileCard}>
            <div style={styles.fileHeader}>
              <div>
                <div style={styles.fileName}>{file.file_name}</div>
                <div style={styles.fileInfo}>
                  File ID: {file.id} • {file.processing_total?.toLocaleString()} records
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
                  width: `${progress}%`,
                  background: isProcessing 
                    ? 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
                    : 'linear-gradient(90deg, #fbbf24 0%, #f59e0b 100%)'
                }}
              />
            </div>
            
            <div style={styles.progressText}>
              {file.processing_offset?.toLocaleString() || 0} / {file.processing_total?.toLocaleString() || 0} ({progress.toFixed(1)}%)
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
  title: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#333',
    marginBottom: '20px',
  },
  loading: {
    textAlign: 'center',
    padding: '20px',
    color: '#666',
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
    color: '#666',
  },
  status: {
    fontSize: '14px',
    fontWeight: '600',
    padding: '5px 12px',
    borderRadius: '20px',
    background: '#e0e0e0',
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
    color: '#666',
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