'use client';

import { useState, useEffect } from 'react';
import processingQueue from '../../lib/processingQueue';

export default function QueueMonitor() {
  const [queueStatus, setQueueStatus] = useState(null);

  useEffect(() => {
    // Subscribe to queue updates
    const unsubscribe = processingQueue.subscribe((status) => {
      setQueueStatus(status);
    });

    // Get initial status
    setQueueStatus(processingQueue.getStatus());

    return () => unsubscribe();
  }, []);

  if (!queueStatus) return null;

  const { isProcessing, currentFile, queueLength, nextFiles } = queueStatus;

  // Don't show if nothing is happening
  if (!isProcessing && queueLength === 0) return null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>🔄 Processing Queue</h3>
        {queueLength > 0 && (
          <span style={styles.badge}>{queueLength} waiting</span>
        )}
      </div>

      {/* Currently processing file */}
      {currentFile && (
        <div style={styles.currentFile}>
          <div style={styles.fileHeader}>
            <span style={styles.fileName}>📄 {currentFile.fileName}</span>
            <span style={styles.service}>
              {currentFile.service === 'blooio' ? '📱 Blooio' : '✉️ SubscriberVerify'}
            </span>
          </div>
          
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${currentFile.progress}%`
              }}
            />
          </div>
          
          <div style={styles.stats}>
            <span>{currentFile.currentOffset.toLocaleString()} / {currentFile.totalRecords.toLocaleString()}</span>
            <span>{currentFile.progress.toFixed(1)}%</span>
          </div>
        </div>
      )}

      {/* Queued files */}
      {nextFiles.length > 0 && (
        <div style={styles.queueList}>
          <h4 style={styles.queueTitle}>📋 Queued Files:</h4>
          {nextFiles.map((file, index) => (
            <div key={file.fileId} style={styles.queuedFile}>
              <span style={styles.queuePosition}>#{index + 1}</span>
              <span style={styles.queuedFileName}>{file.fileName}</span>
              <span style={styles.queuedRecords}>
                {file.totalRecords.toLocaleString()} records
              </span>
            </div>
          ))}
        </div>
      )}

      {!isProcessing && queueLength === 0 && (
        <div style={styles.idleMessage}>
          ✅ All files processed!
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '20px',
    borderRadius: '15px',
    marginBottom: '30px',
    boxShadow: '0 10px 30px rgba(102, 126, 234, 0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    margin: 0,
    fontSize: '20px',
    fontWeight: '700',
  },
  badge: {
    background: 'rgba(255, 255, 255, 0.2)',
    padding: '5px 15px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '600',
  },
  currentFile: {
    background: 'rgba(255, 255, 255, 0.1)',
    padding: '15px',
    borderRadius: '10px',
    marginBottom: '15px',
  },
  fileHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  fileName: {
    fontSize: '16px',
    fontWeight: '600',
  },
  service: {
    fontSize: '14px',
    opacity: 0.9,
  },
  progressBar: {
    height: '8px',
    background: 'rgba(255, 255, 255, 0.2)',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #4ade80 0%, #22c55e 100%)',
    transition: 'width 0.3s ease',
    borderRadius: '4px',
  },
  stats: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '14px',
    opacity: 0.9,
  },
  queueList: {
    background: 'rgba(255, 255, 255, 0.05)',
    padding: '15px',
    borderRadius: '10px',
  },
  queueTitle: {
    margin: '0 0 10px 0',
    fontSize: '14px',
    fontWeight: '600',
    opacity: 0.8,
  },
  queuedFile: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  },
  queuePosition: {
    background: 'rgba(255, 255, 255, 0.2)',
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: '700',
  },
  queuedFileName: {
    flex: 1,
    fontSize: '14px',
  },
  queuedRecords: {
    fontSize: '12px',
    opacity: 0.8,
  },
  idleMessage: {
    textAlign: 'center',
    padding: '20px',
    fontSize: '16px',
    fontWeight: '600',
  },
};