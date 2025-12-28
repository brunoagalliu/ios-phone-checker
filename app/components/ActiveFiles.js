'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export default function ActiveFiles() {
    const [activeFiles, setActiveFiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
  
    const fetchActiveFiles = useCallback(async () => {
      try {
        const response = await fetch('/api/active-files');
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
          // ✅ Safety check: ensure activeFiles is an array
          const files = data.activeFiles || data.files || [];
          setActiveFiles(Array.isArray(files) ? files : []);
          setError(null);
          
          if (data.warning) {
            console.warn('Active files warning:', data.warning);
          }
        } else {
          throw new Error(data.error || 'Failed to fetch active files');
        }
      } catch (error) {
        console.error('Failed to fetch active files:', error);
        setError(error.message);
      } finally {
        setLoading(false);
      }
    }, []);
  
    useEffect(() => {
      fetchActiveFiles();
      
      const interval = setInterval(fetchActiveFiles, 10000);
      return () => clearInterval(interval);
    }, [fetchActiveFiles]);
  
    // ✅ Safety check: Don't render if activeFiles is not an array
    if (!Array.isArray(activeFiles)) {
      return null;
    }
  
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
          // ✅ Safety checks for file properties
          if (!file || !file.id) return null;
          
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
      maxWidth: '800px',
      margin: '20px auto',
      padding: '20px',
      background: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px'
    },
    title: {
      fontSize: '24px',
      fontWeight: '600',
      color: '#1f2937',
      margin: 0
    },
    loading: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px',
      color: '#6b7280'
    },
    spinner: {
      width: '40px',
      height: '40px',
      border: '4px solid #e5e7eb',
      borderTop: '4px solid #667eea',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginBottom: '15px'
    },
    errorBox: {
      padding: '30px',
      textAlign: 'center',
      background: '#fef2f2',
      borderRadius: '8px'
    },
    errorIcon: {
      fontSize: '48px',
      marginBottom: '15px'
    },
    errorText: {
      color: '#dc2626',
      fontSize: '16px',
      marginBottom: '20px'
    },
    retryButton: {
      padding: '10px 20px',
      background: '#667eea',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer'
    },
    errorBadge: {
      padding: '6px 12px',
      background: '#fef2f2',
      color: '#dc2626',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: '500'
    },
    fileCard: {
      background: '#f9fafb',
      padding: '20px',
      borderRadius: '8px',
      marginBottom: '15px',
      border: '1px solid #e5e7eb'
    },
    fileHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: '15px'
    },
    fileName: {
      fontSize: '18px',
      fontWeight: '600',
      color: '#1f2937',
      marginBottom: '5px'
    },
    fileInfo: {
      fontSize: '14px',
      color: '#6b7280'
    },
    status: {
      padding: '6px 12px',
      background: '#fff',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      border: '1px solid #e5e7eb'
    },
    progressBar: {
      width: '100%',
      height: '20px',
      background: '#e5e7eb',
      borderRadius: '10px',
      overflow: 'hidden',
      marginBottom: '10px'
    },
    progressFill: {
      height: '100%',
      transition: 'width 0.3s ease'
    },
    progressText: {
      fontSize: '14px',
      color: '#6b7280',
      marginBottom: '15px'
    },
    actions: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    },
    resumeButton: {
      padding: '10px 20px',
      background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer'
    },
    cancelButton: {
      padding: '10px 20px',
      background: '#ef4444',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer'
    },
    processingNote: {
      flex: 1,
      color: '#10b981',
      fontSize: '14px',
      fontWeight: '500'
    }
  };