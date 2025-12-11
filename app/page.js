'use client';

import { useState } from 'react';
import Papa from 'papaparse';
import FileUploader from './components/FileUploader';
import ProcessingQueue from './components/ProcessingQueue';
import FileHistory from './components/FileHistory';
import Instructions from './components/Instructions';

export default function Home() {
  const [processingFiles, setProcessingFiles] = useState([]);
  const [error, setError] = useState(null);

  const handleFilesSelected = async (files, service) => {
    setError(null);
    
    const newFiles = files.map(file => ({
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      file: file,
      service: service, // 'blooio' or 'subscriberverify'
      status: 'queued',
      totalNumbers: 0,
      validNumbers: 0,
      processedCount: 0,
      validationResults: null,
      results: null,
      error: null,
    }));
  
    setProcessingFiles(prev => [...prev, ...newFiles]);
  
    for (const fileItem of newFiles) {
      await processFile(fileItem);
    }
  };

  const updateFileStatus = (fileId, updates) => {
    setProcessingFiles(prev =>
      prev.map(f => f.id === fileId ? { ...f, ...updates } : f)
    );
  };

  const findPhoneColumn = (data) => {
    if (data.length === 0) return null;
    
    const firstRow = data[0];
    const possibleColumns = ['phone', 'phone_number', 'phonenumber', 'mobile', 'number', 'cell', 'telephone'];
    
    for (const col of Object.keys(firstRow)) {
      const lowerCol = col.toLowerCase().trim();
      if (possibleColumns.includes(lowerCol)) {
        return col;
      }
    }
    
    return Object.keys(firstRow)[0];
  };

  const processFile = async (fileItem) => {
    try {
      updateFileStatus(fileItem.id, { status: 'processing' });
  
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
      const formData = new FormData();
      formData.append('file', fileItem.file);
      formData.append('batchId', batchId);
      formData.append('fileName', fileItem.name);
  
      // Route to correct API based on selected service
      const apiEndpoint = fileItem.service === 'subscriberverify' 
        ? '/api/check-batch-sv' 
        : '/api/check-batch';
  
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        body: formData,
      });
  
      const data = await response.json();
  
      if (!response.ok) {
        throw new Error(data.error || 'Failed to process');
      }
      // Debug logging
console.log('API Response:', data);
console.log('Results file URL:', data.results_file_url);
console.log('Original file URL:', data.original_file_url);
  
      updateFileStatus(fileItem.id, {
        status: 'completed',
        service: data.service || fileItem.service,
        validationResults: data.validation,
        validNumbers: data.validation?.valid || data.total_processed,
        processedCount: data.total_processed,
        results: data.results,
        batchId: batchId,
        originalFileUrl: data.original_file_url,  // Make sure this is set
        resultsFileUrl: data.results_file_url,     // Make sure this is set
        subscriberVerifyStats: data.subscriber_verify_stats,
        cacheHits: data.cache_hits,
        apiCalls: data.api_calls
      });
  
      if (typeof FileHistory.refresh === 'function') {
        FileHistory.refresh();
      }
    } catch (err) {
      updateFileStatus(fileItem.id, {
        status: 'error',
        error: err.message
      });
    }
  };

  const downloadFileResults = (fileItem) => {
    if (!fileItem.results) return;

    const csv = Papa.unparse(fileItem.results.map(r => ({
      original_number: r.original_number || r.phone_number,
      formatted_number: r.formatted_number || r.phone_number,
      is_ios: r.is_ios ? 'YES' : 'NO',
      supports_imessage: r.supports_imessage ? 'YES' : 'NO',
      supports_sms: r.supports_sms ? 'YES' : 'NO',
      from_cache: r.from_cache ? 'YES' : 'NO',
      error: r.error || 'None',
      checked_at: new Date().toISOString()
    })));

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileItem.name.replace('.csv', '')}_results_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const clearCompleted = () => {
    setProcessingFiles(prev => prev.filter(f => f.status !== 'completed'));
  };

  const downloadAllResults = () => {
    processingFiles
      .filter(f => f.status === 'completed' && f.results)
      .forEach(f => downloadFileResults(f));
  };

  const hasCompletedFiles = processingFiles.some(f => f.status === 'completed');
  const isProcessing = processingFiles.some(f => f.status === 'processing');

  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <h1 style={styles.h1}>📱 iOS Phone Number Batch Checker</h1>
        <p style={styles.subtitle}>US numbers only • Validates • Deduplicates • Checks iOS</p>

        <div style={styles.infoBox}>
          <strong>✅ Smart Processing</strong>
          <ul style={{ marginTop: '10px', paddingLeft: '20px', fontSize: '12px' }}>
            <li>Upload multiple CSV files at once</li>
            <li>Validates US phone numbers (proper area codes & format)</li>
            <li>Auto-formats to: 1 + 10 digits (e.g., 18503631955)</li>
            <li>Removes duplicates, blanks, and invalid numbers</li>
            <li>Caches results for 6 months (saves API calls)</li>
            <li>Real-time progress tracking for each file</li>
          </ul>
        </div>

        <FileUploader 
          onFilesSelected={handleFilesSelected}
          disabled={isProcessing}
        />

        {error && (
          <div style={styles.errorBox}>
            ❌ {error}
          </div>
        )}

        {processingFiles.length > 0 && (
          <ProcessingQueue files={processingFiles} />
        )}

        {hasCompletedFiles && (
          <div style={styles.actionsBar}>
            <button onClick={clearCompleted} style={styles.clearButton}>
              🗑️ Clear Completed Files
            </button>
            <button 
              onClick={downloadAllResults}
              style={styles.downloadAllButton}
            >
              ⬇️ Download All Results
            </button>
          </div>
        )}

        <FileHistory />
        <Instructions />
      </div>
    </div>
  );
}

const styles = {
  body: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  container: {
    background: 'white',
    borderRadius: '20px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    maxWidth: '1000px',
    width: '100%',
    padding: '40px',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  h1: {
    color: '#333',
    fontSize: '28px',
    marginBottom: '10px',
    textAlign: 'center',
  },
  subtitle: {
    color: '#666',
    textAlign: 'center',
    marginBottom: '30px',
    fontSize: '14px',
  },
  infoBox: {
    background: '#d4edda',
    border: '1px solid #28a745',
    borderRadius: '10px',
    padding: '15px',
    marginBottom: '20px',
    fontSize: '13px',
    color: '#155724',
  },
  errorBox: {
    background: '#f8d7da',
    border: '2px solid #dc3545',
    borderRadius: '10px',
    padding: '15px',
    marginBottom: '20px',
    color: '#721c24',
  },
  actionsBar: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
  },
  clearButton: {
    flex: 1,
    padding: '12px',
    background: '#6c757d',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  downloadAllButton: {
    flex: 1,
    padding: '12px',
    background: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
};