'use client';

import { useState, useEffect } from 'react';
import Papa from 'papaparse';

export default function FileHistory() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadFileHistory();
  }, []);

  const loadFileHistory = async () => {
    try {
      const response = await fetch('/api/files');
      const data = await response.json();
      if (data.success) {
        setUploadedFiles(data.files);
      }
    } catch (err) {
      console.error('Failed to load file history:', err);
    }
  };

  const downloadFileResults = async (file) => {
    // Try direct Blob URL first
    if (file.results_file_url) {
      console.log('Downloading from Blob:', file.results_file_url);
      const a = document.createElement('a');
      a.href = file.results_file_url;
      a.download = `${file.original_name.replace('.csv', '')}_results.csv`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // Fallback: fetch from API (old method)
    try {
      const response = await fetch(`/api/files?batchId=${file.batch_id}`);
      const data = await response.json();
      
      if (data.success && data.results) {
        const csv = Papa.unparse(data.results.map(r => ({
          phone_number: r.phone_number,
          is_ios: r.is_ios ? 'YES' : 'NO',
          supports_imessage: r.supports_imessage ? 'YES' : 'NO',
          supports_sms: r.supports_sms ? 'YES' : 'NO',
          error: r.error || 'None',
          checked_at: r.last_checked
        })));

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${file.original_name.replace('.csv', '')}_results.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert('Failed to download file results: ' + err.message);
    }
  };

  // Expose refresh function
  FileHistory.refresh = loadFileHistory;

  return (
    <div style={styles.container}>
      <button 
        onClick={() => setShowHistory(!showHistory)}
        style={styles.toggleButton}
      >
        📂 {showHistory ? 'Hide' : 'Show'} File History ({uploadedFiles.length})
      </button>
      
      {showHistory && uploadedFiles.length > 0 && (
        <div style={styles.historyList}>
          {uploadedFiles.map((file) => (
            <div key={file.id} style={styles.historyItem}>
              <div style={styles.historyInfo}>
                <div style={styles.historyName}>{file.original_name}</div>
                <div style={styles.historyMeta}>
                  Uploaded: {new Date(file.upload_date).toLocaleString()} •
                  Valid: {file.valid_numbers} •
                  Invalid: {file.invalid_numbers} •
                  Status: <span style={file.processing_status === 'completed' ? {color: '#28a745', fontWeight: '600'} : {}}>{file.processing_status}</span>
                </div>
                {file.results_file_url && (
                  <div style={styles.blobUrl}>
                    📦 Stored in Vercel Blob
                  </div>
                )}
              </div>
              <button
                onClick={() => downloadFileResults(file)}
                style={{
                  ...styles.downloadButton,
                  ...(file.processing_status !== 'completed' ? {opacity: 0.5, cursor: 'not-allowed'} : {})
                }}
                disabled={file.processing_status !== 'completed'}
              >
                ⬇️ Download
              </button>
            </div>
          ))}
        </div>
      )}
      
      {showHistory && uploadedFiles.length === 0 && (
        <div style={styles.emptyState}>
          No files uploaded yet
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    marginTop: '30px',
    borderTop: '2px solid #e0e0e0',
    paddingTop: '20px',
  },
  toggleButton: {
    width: '100%',
    padding: '12px',
    background: '#f8f9fa',
    border: '2px solid #dee2e6',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
    color: '#333',
  },
  historyList: {
    marginTop: '15px',
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px',
    background: '#f8f9fa',
    borderRadius: '8px',
    marginBottom: '10px',
    border: '1px solid #dee2e6',
  },
  historyInfo: {
    flex: 1,
  },
  historyName: {
    fontWeight: '600',
    color: '#333',
    marginBottom: '5px',
    fontSize: '14px',
  },
  historyMeta: {
    fontSize: '12px',
    color: '#666',
  },
  blobUrl: {
    fontSize: '11px',
    color: '#17a2b8',
    marginTop: '4px',
    fontStyle: 'italic',
  },
  downloadButton: {
    padding: '8px 16px',
    background: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  emptyState: {
    padding: '20px',
    textAlign: 'center',
    color: '#666',
    fontSize: '14px',
  },
};