'use client';

import { useState } from 'react';

export default function FileProgressChecker() {
  const [fileId, setFileId] = useState('');
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkProgress = async () => {
    if (!fileId) {
      setError('Please enter a file ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/file-progress?fileId=${fileId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch progress');
      }

      setProgress(data);
    } catch (err) {
      setError(err.message);
      setProgress(null);
    } finally {
      setLoading(false);
    }
  };

  const resumeProcessing = async () => {
    if (!progress) return;

    try {
      const endpoint = progress.service === 'blooio' 
        ? '/api/check-batch-blooio-chunked'
        : '/api/check-batch-chunked';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileId: parseInt(fileId), 
          resumeFrom: progress.processing_offset 
        })
      });

      const data = await response.json();
      
      if (data.success) {
        alert(`Chunk processed! ${data.processed} / ${data.total} complete`);
        checkProgress(); // Refresh progress
      } else {
        alert('Error: ' + data.error);
      }
    } catch (err) {
      alert('Failed to resume: ' + err.message);
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🔍 Check File Progress</h3>
      
      <div style={styles.inputGroup}>
        <input
          type="text"
          placeholder="Enter File ID"
          value={fileId}
          onChange={(e) => setFileId(e.target.value)}
          style={styles.input}
        />
        <button 
          onClick={checkProgress}
          disabled={loading}
          style={styles.checkButton}
        >
          {loading ? '⏳ Checking...' : '🔍 Check Progress'}
        </button>
      </div>

      {error && (
        <div style={styles.error}>
          ❌ {error}
        </div>
      )}

      {progress && (
        <div style={styles.progressCard}>
          <div style={styles.progressHeader}>
            <h4 style={styles.fileName}>📄 {progress.file_name}</h4>
            <div style={{
              ...styles.statusBadge,
              background: getStatusColor(progress.processing_status)
            }}>
              {progress.processing_status}
            </div>
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.statItem}>
              <div style={styles.statLabel}>Service</div>
              <div style={styles.statValue}>
                {progress.service === 'blooio' ? '📱 Blooio' : '✅ SubscriberVerify'}
              </div>
            </div>

            <div style={styles.statItem}>
              <div style={styles.statLabel}>Progress</div>
              <div style={styles.statValue}>
                {progress.processing_offset.toLocaleString()} / {progress.processing_total.toLocaleString()}
              </div>
            </div>

            <div style={styles.statItem}>
              <div style={styles.statLabel}>Percentage</div>
              <div style={styles.statValue}>
                {progress.processing_progress}%
              </div>
            </div>

            <div style={styles.statItem}>
              <div style={styles.statLabel}>Valid Numbers</div>
              <div style={styles.statValue}>
                {progress.valid_numbers.toLocaleString()}
              </div>
            </div>
          </div>

          <div style={styles.progressBarContainer}>
            <div style={styles.progressBar}>
              <div style={{
                ...styles.progressFill,
                width: `${progress.processing_progress}%`
              }} />
            </div>
            <div style={styles.progressText}>
              {progress.processing_progress}% Complete
            </div>
          </div>

          {progress.results_file_url && (
            <div style={styles.downloadSection}>
              <a 
                href={progress.results_file_url}
                download
                style={styles.downloadButton}
              >
                ⬇️ Download Results
              </a>
            </div>
          )}

          {progress.processing_status === 'processing' && (
            <div style={styles.actionSection}>
              <button 
                onClick={resumeProcessing}
                style={styles.resumeButton}
              >
                ▶️ Process Next Chunk
              </button>
              <p style={styles.hint}>
                💡 Click this button repeatedly to continue processing, or use the automatic processor above.
              </p>
            </div>
          )}

          {progress.processing_status === 'initialized' && (
            <div style={styles.actionSection}>
              <button 
                onClick={resumeProcessing}
                style={styles.startButton}
              >
                ▶️ Start Processing
              </button>
            </div>
          )}

          <div style={styles.detailsSection}>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>File ID:</span>
              <span style={styles.detailValue}>{progress.id}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Batch ID:</span>
              <span style={styles.detailValue}>{progress.batch_id}</span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Upload Date:</span>
              <span style={styles.detailValue}>
                {new Date(progress.upload_date).toLocaleString()}
              </span>
            </div>
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>Can Resume:</span>
              <span style={styles.detailValue}>
                {progress.can_resume ? '✅ Yes' : '❌ No'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getStatusColor(status) {
  switch (status) {
    case 'completed': return '#28a745';
    case 'processing': return '#17a2b8';
    case 'initialized': return '#ffc107';
    case 'failed': return '#dc3545';
    default: return '#6c757d';
  }
}

const styles = {
  container: {
    background: '#f8f9fa',
    borderRadius: '12px',
    padding: '20px',
    marginTop: '30px',
    border: '2px solid #e0e0e0',
  },
  title: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '15px',
  },
  inputGroup: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
  },
  input: {
    flex: 1,
    padding: '12px',
    border: '2px solid #dee2e6',
    borderRadius: '8px',
    fontSize: '14px',
  },
  checkButton: {
    padding: '12px 24px',
    background: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },
  error: {
    padding: '12px',
    background: '#f8d7da',
    border: '1px solid #f5c6cb',
    borderRadius: '6px',
    color: '#721c24',
    marginBottom: '15px',
  },
  progressCard: {
    background: 'white',
    borderRadius: '10px',
    padding: '20px',
    border: '2px solid #dee2e6',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    paddingBottom: '15px',
    borderBottom: '2px solid #e0e0e0',
  },
  fileName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  statusBadge: {
    padding: '6px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'white',
    textTransform: 'uppercase',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
  },
  statItem: {
    textAlign: 'center',
  },
  statLabel: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '5px',
  },
  statValue: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#333',
  },
  progressBarContainer: {
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
    background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
    transition: 'width 0.3s ease',
  },
  progressText: {
    textAlign: 'right',
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
  },
  downloadSection: {
    marginBottom: '20px',
    textAlign: 'center',
  },
  downloadButton: {
    display: 'inline-block',
    padding: '12px 24px',
    background: '#28a745',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
  },
  actionSection: {
    marginBottom: '20px',
    textAlign: 'center',
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
    marginBottom: '10px',
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
  },
  hint: {
    fontSize: '12px',
    color: '#666',
    fontStyle: 'italic',
    margin: '5px 0 0 0',
  },
  detailsSection: {
    background: '#f8f9fa',
    padding: '15px',
    borderRadius: '8px',
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #dee2e6',
  },
  detailLabel: {
    fontSize: '13px',
    color: '#666',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: '13px',
    color: '#333',
    fontWeight: '600',
  },
};