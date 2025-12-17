'use client';

import { useState } from 'react';

export default function FileProgressChecker() {
  const [fileId, setFileId] = useState('');
  const [fileData, setFileData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const checkProgress = async () => {
    if (!fileId || !fileId.trim()) {
      setError('Please enter a file ID');
      return;
    }

    setLoading(true);
    setError(null);
    setFileData(null);

    try {
      const response = await fetch(`/api/file-progress?fileId=${fileId}`);
      const data = await response.json();

      if (!data.success) {
        setError(data.error || 'Failed to fetch file progress');
        return;
      }

      setFileData(data.file);
    } catch (err) {
      setError('Failed to fetch file progress: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    if (!fileData) return;

    setLoading(true);
    try {
      const response = await fetch('/api/check-batch-blooio-chunked', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fileId: fileData.id, 
          resumeFrom: fileData.processing_offset || 0
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('✅ Processing resumed! Will continue automatically.');
        checkProgress(); // Refresh data
      } else {
        alert('❌ Failed to resume: ' + result.error);
      }
    } catch (err) {
      alert('❌ Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoProcess = async () => {
    if (!fileData) return;

    const confirmed = confirm(
      `Start auto-processing for File ${fileData.id}?\n\n` +
      `This will process all remaining chunks automatically.\n` +
      `Remaining: ${((fileData.processing_total || 0) - (fileData.processing_offset || 0)).toLocaleString()} records`
    );

    if (!confirmed) return;

    handleResume(); // Same as resume, but with confirmation
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>🔍 Check File Progress</h3>

      <div style={styles.searchBox}>
        <input
          type="number"
          placeholder="Enter File ID"
          value={fileId}
          onChange={(e) => setFileId(e.target.value)}
          style={styles.input}
          onKeyPress={(e) => e.key === 'Enter' && checkProgress()}
        />
        <button 
          onClick={checkProgress} 
          disabled={loading}
          style={styles.button}
        >
          {loading ? '⏳ Checking...' : '🔍 Check Progress'}
        </button>
      </div>

      {error && (
        <div style={styles.error}>
          ❌ {error}
        </div>
      )}

      {fileData && (
        <div style={styles.resultCard}>
          <div style={styles.resultHeader}>
            <h4 style={styles.fileName}>
              📄 {fileData.file_name || 'Unknown File'}
            </h4>
            <span style={{
              ...styles.statusBadge,
              background: fileData.processing_status === 'completed' ? '#10b981' :
                          fileData.processing_status === 'processing' ? '#3b82f6' :
                          fileData.processing_status === 'failed' ? '#ef4444' : 
                          fileData.processing_status === 'initialized' ? '#f59e0b' : '#6b7280'
            }}>
              {(fileData.processing_status || 'unknown').toUpperCase()}
            </span>
          </div>

          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${Math.min(100, Math.max(0, fileData.processing_progress || 0))}%`
              }}
            />
          </div>

          <div style={styles.statsGrid}>
            <div style={styles.statItem}>
              <span style={styles.statLabel}>Progress</span>
              <span style={styles.statValue}>
                {(fileData.processing_offset || 0).toLocaleString()} / {(fileData.processing_total || 0).toLocaleString()}
              </span>
              <span style={styles.statPercent}>
                {(fileData.processing_progress || 0).toFixed(1)}%
              </span>
            </div>

            <div style={styles.statItem}>
              <span style={styles.statLabel}>Remaining</span>
              <span style={styles.statValue}>
                {((fileData.processing_total || 0) - (fileData.processing_offset || 0)).toLocaleString()} records
              </span>
            </div>

            <div style={styles.statItem}>
              <span style={styles.statLabel}>Can Resume</span>
              <span style={styles.statValue}>
                {fileData.can_resume ? '✅ Yes' : '❌ No'}
              </span>
            </div>

            <div style={styles.statItem}>
              <span style={styles.statLabel}>Has State</span>
              <span style={styles.statValue}>
                {fileData.processing_state ? '✅ Yes' : '❌ No'}
              </span>
            </div>

            {fileData.last_error && (
              <div style={styles.statItemFull}>
                <span style={styles.statLabel}>Last Error</span>
                <span style={styles.statError}>
                  {fileData.last_error}
                </span>
              </div>
            )}

            {fileData.upload_date && (
              <div style={styles.statItem}>
                <span style={styles.statLabel}>Upload Date</span>
                <span style={styles.statValue}>
                  {new Date(fileData.upload_date).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          <div style={styles.actionButtons}>
            {fileData.can_resume && fileData.processing_status !== 'completed' && (
              <>
                <button 
                  onClick={handleResume}
                  disabled={loading}
                  style={styles.resumeButton}
                >
                  {loading ? '⏳ Processing...' : '▶️ Resume Processing'}
                </button>

                <button 
                  onClick={handleAutoProcess}
                  disabled={loading}
                  style={styles.autoButton}
                >
                  🚀 Auto-Process All Chunks
                </button>
              </>
            )}

            {fileData.processing_status === 'completed' && (
              <div style={styles.completedBadge}>
                ✅ File processing completed!
              </div>
            )}

            {!fileData.can_resume && fileData.processing_status !== 'completed' && (
              <div style={styles.warningBadge}>
                ⚠️ File cannot be resumed. Please re-upload or reinitialize.
              </div>
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
  searchBox: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    fontSize: '16px',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.3s',
  },
  button: {
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    whiteSpace: 'nowrap',
  },
  error: {
    padding: '12px 16px',
    background: '#fee2e2',
    border: '2px solid #fecaca',
    borderRadius: '8px',
    color: '#991b1b',
    marginBottom: '20px',
    fontSize: '14px',
  },
  resultCard: {
    background: 'white',
    padding: '20px',
    borderRadius: '10px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '15px',
    flexWrap: 'wrap',
    gap: '10px',
  },
  fileName: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
  },
  statusBadge: {
    padding: '6px 14px',
    borderRadius: '20px',
    color: 'white',
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.5px',
  },
  progressBar: {
    height: '10px',
    background: '#e0e0e0',
    borderRadius: '5px',
    overflow: 'hidden',
    marginBottom: '20px',
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
    transition: 'width 0.5s ease',
    borderRadius: '5px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  statItemFull: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    gridColumn: '1 / -1',
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  statValue: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1f2937',
  },
  statPercent: {
    fontSize: '14px',
    color: '#667eea',
    fontWeight: '700',
  },
  statError: {
    fontSize: '14px',
    color: '#ef4444',
    fontWeight: '500',
    padding: '8px',
    background: '#fee2e2',
    borderRadius: '6px',
  },
  actionButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  resumeButton: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
  },
  autoButton: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
  },
  completedBadge: {
    padding: '12px',
    background: '#d1fae5',
    border: '2px solid #a7f3d0',
    borderRadius: '8px',
    color: '#065f46',
    fontSize: '14px',
    fontWeight: '600',
    textAlign: 'center',
  },
  warningBadge: {
    padding: '12px',
    background: '#fef3c7',
    border: '2px solid #fde68a',
    borderRadius: '8px',
    color: '#92400e',
    fontSize: '14px',
    fontWeight: '600',
    textAlign: 'center',
  },
};