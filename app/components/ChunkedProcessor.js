'use client';

import { useState, useEffect, useRef } from 'react';

export default function ChunkedProcessor({ fileId, totalRecords, onComplete }) {
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    cacheHits: 0,
    apiCalls: 0,
    elapsedTime: 0,
    chunksProcessed: 0
  });
  const [isPaused, setIsPaused] = useState(false);
  const processingRef = useRef(false);

  useEffect(() => {
    if (processing && !isPaused && currentOffset < totalRecords && !processingRef.current) {
      processNextChunk();
    }
  }, [processing, isPaused, currentOffset, totalRecords]);

  const processNextChunk = async () => {
    if (processingRef.current) return; // Prevent duplicate calls
    
    processingRef.current = true;
    setError(null);

    try {
      console.log(`Processing chunk starting at offset ${currentOffset}`);
      
      const response = await fetch('/api/check-batch-chunked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileId, 
          resumeFrom: currentOffset 
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Processing failed');
      }

      const data = await response.json();

      console.log('Chunk processed:', data);

      setProgress(data.progress);
      setCurrentOffset(data.processed);
      setStats(prev => ({
        cacheHits: prev.cacheHits + (data.cacheHits || 0),
        apiCalls: prev.apiCalls + (data.apiCalls || 0),
        elapsedTime: prev.elapsedTime + parseFloat(data.elapsedSeconds || 0),
        chunksProcessed: prev.chunksProcessed + 1
      }));

      if (data.isComplete) {
        setProcessing(false);
        if (onComplete) {
          onComplete(data);
        }
      }
    } catch (error) {
      console.error('Chunk processing error:', error);
      setError(error.message);
      setProcessing(false);
    } finally {
      processingRef.current = false;
    }
  };

  const startProcessing = () => {
    setProcessing(true);
    setIsPaused(false);
    setError(null);
  };

  const pauseProcessing = () => {
    setIsPaused(true);
  };

  const resumeProcessing = () => {
    setIsPaused(false);
    setProcessing(true);
  };

  const stopProcessing = () => {
    setProcessing(false);
    setIsPaused(false);
  };

  const estimatedTimeRemaining = () => {
    if (stats.chunksProcessed === 0) return 'Calculating...';
    
    const avgTimePerChunk = stats.elapsedTime / stats.chunksProcessed;
    const remainingRecords = totalRecords - currentOffset;
    const remainingChunks = Math.ceil(remainingRecords / 5000);
    const remainingSeconds = remainingChunks * avgTimePerChunk;
    
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = Math.floor(remainingSeconds % 60);
    
    return `${minutes}m ${seconds}s`;
  };

  const isComplete = currentOffset >= totalRecords;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>📊 Chunked Processing</h3>
        <div style={styles.recordCount}>
          {currentOffset.toLocaleString()} / {totalRecords.toLocaleString()} records
        </div>
      </div>

      {/* Progress Bar */}
      <div style={styles.progressSection}>
        <div style={styles.progressBar}>
          <div 
            style={{
              ...styles.progressFill,
              width: `${progress}%`,
              background: error ? '#dc3545' : isComplete ? '#28a745' : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
            }}
          />
        </div>
        <div style={styles.progressText}>
          {progress.toFixed(2)}%
        </div>
      </div>

      {/* Control Buttons */}
      <div style={styles.controls}>
        {!processing && !isComplete && (
          <button
            onClick={startProcessing}
            style={styles.startButton}
          >
            ▶️ {currentOffset > 0 ? 'Resume' : 'Start'} Processing
          </button>
        )}

        {processing && !isPaused && (
          <button
            onClick={pauseProcessing}
            style={styles.pauseButton}
          >
            ⏸️ Pause
          </button>
        )}

        {processing && isPaused && (
          <button
            onClick={resumeProcessing}
            style={styles.resumeButton}
          >
            ▶️ Resume
          </button>
        )}

        {(processing || isPaused) && !isComplete && (
          <button
            onClick={stopProcessing}
            style={styles.stopButton}
          >
            ⏹️ Stop
          </button>
        )}

        {isComplete && (
          <div style={styles.completeMessage}>
            ✅ Processing Complete!
          </div>
        )}
      </div>

      {/* Stats */}
      {(processing || currentOffset > 0) && (
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Chunks Processed</div>
            <div style={styles.statValue}>{stats.chunksProcessed}</div>
          </div>
          
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Cache Hits</div>
            <div style={styles.statValue}>{stats.cacheHits.toLocaleString()}</div>
          </div>
          
          <div style={styles.statCard}>
            <div style={styles.statLabel}>API Calls</div>
            <div style={styles.statValue}>{stats.apiCalls.toLocaleString()}</div>
          </div>
          
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Time Elapsed</div>
            <div style={styles.statValue}>
              {Math.floor(stats.elapsedTime / 60)}m {Math.floor(stats.elapsedTime % 60)}s
            </div>
          </div>

          {processing && !isComplete && (
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Est. Time Remaining</div>
              <div style={styles.statValue}>{estimatedTimeRemaining()}</div>
            </div>
          )}
        </div>
      )}

      {/* Status Messages */}
      {processing && !isPaused && !error && (
        <div style={styles.statusMessage}>
          🔄 Processing chunk {stats.chunksProcessed + 1}...
        </div>
      )}

      {isPaused && (
        <div style={styles.pausedMessage}>
          ⏸️ Processing paused. Click Resume to continue.
        </div>
      )}

      {error && (
        <div style={styles.errorMessage}>
          ❌ Error: {error}
          <button 
            onClick={startProcessing}
            style={styles.retryButton}
          >
            🔄 Retry
          </button>
        </div>
      )}

      {/* Info Box */}
      <div style={styles.infoBox}>
        <div style={styles.infoTitle}>ℹ️ How It Works:</div>
        <ul style={styles.infoList}>
          <li>Processes 5,000 records per chunk (10-15 seconds each)</li>
          <li>You can pause/resume anytime - progress is saved</li>
          <li>Cache is checked first to save API calls</li>
          <li>Results are saved automatically after each chunk</li>
          <li>Safe to close browser - just reload and resume</li>
        </ul>
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: 'white',
    borderRadius: '12px',
    padding: '20px',
    border: '2px solid #e0e0e0',
    marginTop: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  recordCount: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#667eea',
  },
  progressSection: {
    marginBottom: '20px',
  },
  progressBar: {
    width: '100%',
    height: '20px',
    background: '#e9ecef',
    borderRadius: '10px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: '10px',
    color: 'white',
    fontSize: '12px',
    fontWeight: '600',
  },
  progressText: {
    textAlign: 'right',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  controls: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },
  startButton: {
    padding: '12px 24px',
    background: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  pauseButton: {
    padding: '12px 24px',
    background: '#ffc107',
    color: '#333',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  resumeButton: {
    padding: '12px 24px',
    background: '#17a2b8',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  stopButton: {
    padding: '12px 24px',
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  completeMessage: {
    padding: '12px 24px',
    background: '#d4edda',
    color: '#155724',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
  },
  statCard: {
    background: '#f8f9fa',
    padding: '15px',
    borderRadius: '8px',
    textAlign: 'center',
    border: '1px solid #dee2e6',
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '5px',
  },
  statValue: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#333',
  },
  statusMessage: {
    padding: '12px',
    background: '#e7f3ff',
    border: '1px solid #b8daff',
    borderRadius: '6px',
    color: '#004085',
    fontSize: '13px',
    marginBottom: '15px',
    textAlign: 'center',
  },
  pausedMessage: {
    padding: '12px',
    background: '#fff3cd',
    border: '1px solid #ffeaa7',
    borderRadius: '6px',
    color: '#856404',
    fontSize: '13px',
    marginBottom: '15px',
    textAlign: 'center',
  },
  errorMessage: {
    padding: '12px',
    background: '#f8d7da',
    border: '1px solid #f5c6cb',
    borderRadius: '6px',
    color: '#721c24',
    fontSize: '13px',
    marginBottom: '15px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  retryButton: {
    padding: '6px 12px',
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  infoBox: {
    background: '#e7f3ff',
    padding: '15px',
    borderRadius: '8px',
    border: '1px solid #b8daff',
  },
  infoTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#004085',
    marginBottom: '8px',
  },
  infoList: {
    margin: 0,
    paddingLeft: '20px',
    fontSize: '12px',
    color: '#004085',
    lineHeight: '1.8',
  },
};