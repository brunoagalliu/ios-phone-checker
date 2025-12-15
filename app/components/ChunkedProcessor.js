'use client';

import { useState, useEffect, useRef } from 'react';

export default function ChunkedProcessor({ fileId, totalRecords, service, onComplete }) {
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
  const [autoMode, setAutoMode] = useState(false);
  const processingRef = useRef(false);
  const autoModeRef = useRef(false);

  // Auto-process when in auto mode
  useEffect(() => {
    autoModeRef.current = autoMode;
  }, [autoMode]);

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
      
      // Determine which endpoint to use based on service
      const endpoint = service === 'blooio' 
        ? '/api/check-batch-blooio-chunked'
        : '/api/check-batch-chunked';
      
      const response = await fetch(endpoint, {
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
        setAutoMode(false);
        if (onComplete) {
          onComplete(data);
        }
      }
    } catch (error) {
      console.error('Chunk processing error:', error);
      setError(error.message);
      setProcessing(false);
      setAutoMode(false);
    } finally {
      processingRef.current = false;
    }
  };

  const startProcessing = () => {
    setProcessing(true);
    setIsPaused(false);
    setError(null);
  };

  const startAutoMode = () => {
    setAutoMode(true);
    setProcessing(true);
    setIsPaused(false);
    setError(null);
  };

  const pauseProcessing = () => {
    setIsPaused(true);
    setAutoMode(false);
  };

  const resumeProcessing = () => {
    setIsPaused(false);
    setProcessing(true);
  };

  const stopProcessing = () => {
    setProcessing(false);
    setIsPaused(false);
    setAutoMode(false);
  };

  const estimatedTimeRemaining = () => {
    if (stats.chunksProcessed === 0) return 'Calculating...';
    
    const avgTimePerChunk = stats.elapsedTime / stats.chunksProcessed;
    const remainingRecords = totalRecords - currentOffset;
    const chunkSize = service === 'blooio' ? 200 : 5000;
    const remainingChunks = Math.ceil(remainingRecords / chunkSize);
    const remainingSeconds = remainingChunks * avgTimePerChunk;
    
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = Math.floor(remainingSeconds % 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
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
              background: error ? '#dc3545' : isComplete ? '#28a745' : autoMode ? 'linear-gradient(90deg, #28a745 0%, #20c997 100%)' : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
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
          <>
            <button
              onClick={startProcessing}
              style={styles.startButton}
            >
              ▶️ {currentOffset > 0 ? 'Resume Manual' : 'Start Manual'}
            </button>
            <button
              onClick={startAutoMode}
              style={styles.autoButton}
            >
              🚀 {currentOffset > 0 ? 'Resume Auto' : 'Start Auto Processing'}
            </button>
          </>
        )}

        {processing && !isPaused && (
          <>
            <button
              onClick={pauseProcessing}
              style={styles.pauseButton}
            >
              ⏸️ Pause
            </button>
            {autoMode && (
              <div style={styles.autoModeIndicator}>
                🤖 Auto Mode Active
              </div>
            )}
          </>
        )}

        {processing && isPaused && (
          <>
            <button
              onClick={resumeProcessing}
              style={styles.resumeButton}
            >
              ▶️ Resume
            </button>
            <button
              onClick={startAutoMode}
              style={styles.autoButton}
            >
              🚀 Resume Auto
            </button>
          </>
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

      {/* Mode Explanation */}
      {!processing && !isComplete && (
        <div style={styles.modeExplanation}>
          <div style={styles.modeOption}>
            <strong>▶️ Manual Mode:</strong> Click "Process Next Chunk" for each chunk
          </div>
          <div style={styles.modeOption}>
            <strong>🚀 Auto Mode:</strong> Automatically processes all chunks until complete
          </div>
        </div>
      )}

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
          {autoMode ? (
            <>🤖 Auto-processing chunk {stats.chunksProcessed + 1}... (will continue automatically)</>
          ) : (
            <>🔄 Processing chunk {stats.chunksProcessed + 1}... (click pause to stop)</>
          )}
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
            onClick={startAutoMode}
            style={styles.retryButton}
          >
            🔄 Retry Auto
          </button>
        </div>
      )}

      {/* Info Box */}
      <div style={styles.infoBox}>
        <div style={styles.infoTitle}>ℹ️ How It Works:</div>
        <ul style={styles.infoList}>
          <li><strong>Auto Mode (Recommended):</strong> Click once and let it run. Processes all {Math.ceil(totalRecords / (service === 'blooio' ? 200 : 5000))} chunks automatically.</li>
          <li><strong>Manual Mode:</strong> Click "Process Next Chunk" for each chunk (useful for testing).</li>
          <li>Chunk size: {service === 'blooio' ? '200 records (~50 sec each)' : '5,000 records (~15 sec each)'}</li>
          <li>Cache is checked first to save API calls</li>
          <li>Progress is saved - you can close the browser and resume later</li>
          <li>{service === 'blooio' ? '⚠️ Blooio: 20k records = ~90 minutes total (4 req/sec limit)' : '✅ SubscriberVerify: Bulk API is much faster'}</li>
        </ul>
      </div>

      {/* Warning for Blooio */}
      {service === 'blooio' && totalRecords > 5000 && (
        <div style={styles.warningBox}>
          <strong>⚠️ Blooio Large File Warning:</strong> Processing {totalRecords.toLocaleString()} records will take approximately {Math.ceil(totalRecords / 200 * 50 / 60)} minutes due to API rate limits (4 requests/second). Auto mode will handle this automatically, but you can close this tab and resume later.
        </div>
      )}
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
    alignItems: 'center',
  },
  startButton: {
    padding: '12px 24px',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  autoButton: {
    padding: '12px 24px',
    background: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
    boxShadow: '0 4px 6px rgba(40, 167, 69, 0.3)',
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
  autoModeIndicator: {
    padding: '8px 16px',
    background: '#d4edda',
    color: '#155724',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '600',
    animation: 'pulse 2s infinite',
  },
  modeExplanation: {
    background: '#e7f3ff',
    padding: '15px',
    borderRadius: '8px',
    marginBottom: '20px',
    border: '1px solid #b8daff',
  },
  modeOption: {
    fontSize: '13px',
    color: '#004085',
    marginBottom: '8px',
    lineHeight: '1.6',
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
    marginBottom: '15px',
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
  warningBox: {
    background: '#fff3cd',
    padding: '15px',
    borderRadius: '8px',
    border: '2px solid #ffc107',
    color: '#856404',
    fontSize: '13px',
    lineHeight: '1.6',
  },
};