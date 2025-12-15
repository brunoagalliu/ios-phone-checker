'use client';

import { useState } from 'react';
import FileUploader from './components/FileUploader';
import ProcessingQueue from './components/ProcessingQueue';
import FileHistory from './components/FileHistory';
import Instructions from './components/Instructions';
import ChunkedProcessor from './components/ChunkedProcessor';
import FileProgressChecker from './components/FileProgressChecker';

export default function Home() {
  const [processingFiles, setProcessingFiles] = useState([]);
  const [error, setError] = useState(null);
  const [chunkedProcessing, setChunkedProcessing] = useState(null);

  const handleFilesSelected = async (files, service) => {
    setError(null);
  
    for (const file of files) {
      // UPDATED: Better large file detection
      const fileSizeMB = file.size / (1024 * 1024);
      const estimatedRecords = Math.floor(file.size / 100); // Rough estimate: 100 bytes per record
      
      console.log(`File: ${file.name}, Size: ${fileSizeMB.toFixed(2)} MB, Estimated records: ${estimatedRecords}`);
      
      // Use chunked processing if:
      // - File is > 5MB, OR
      // - Estimated records > 5000
      const shouldUseChunkedProcessing = fileSizeMB > 5 || estimatedRecords > 5000;
      
      if (shouldUseChunkedProcessing) {
        console.log(`✓ Large file detected - using chunked processing`);
        
        try {
          // Initialize for chunked processing
          const formData = new FormData();
          formData.append('file', file);
          formData.append('fileName', file.name);
          formData.append('service', service);
  
          const response = await fetch('/api/init-large-file', {
            method: 'POST',
            body: formData
          });
  
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to initialize file');
          }
  
          const data = await response.json();
  
          if (data.success) {
            setChunkedProcessing({
              fileId: data.fileId,
              totalRecords: data.totalRecords,
              fileName: file.name,
              service: data.service,
              chunkSize: data.chunkSize,
              estimatedChunks: data.estimatedChunks,
              estimatedTime: data.estimatedTime
            });
            
            console.log('✓ File initialized for chunked processing:', data);
          }
        } catch (err) {
          console.error('Failed to initialize large file:', err);
          setError(`Failed to initialize ${file.name}: ${err.message}`);
        }
  
        continue; // Skip normal processing for this file
      }
  
      // Regular processing for small files
      console.log(`Using regular processing for small file`);
      
      const newFile = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        file: file,
        service: service,
        status: 'queued',
        totalNumbers: 0,
        validNumbers: 0,
        processedCount: 0,
        validationResults: null,
        results: null,
        error: null,
      };
  
      setProcessingFiles(prev => [...prev, newFile]);
  
      // Process immediately
      await processFile(newFile);
    }
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

      console.log(`Processing ${fileItem.name} with ${fileItem.service} service...`);

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      console.log('API Response:', data);
      console.log('Results file URL:', data.results_file_url);
      console.log('Original file URL:', data.original_file_url);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process');
      }

      updateFileStatus(fileItem.id, {
        status: 'completed',
        service: data.service || fileItem.service,
        validationResults: data.validation,
        validNumbers: data.validation?.valid || data.total_processed,
        processedCount: data.total_processed,
        results: data.results,
        batchId: batchId,
        originalFileUrl: data.original_file_url,
        resultsFileUrl: data.results_file_url,
        subscriberVerifyStats: data.subscriber_verify_stats,
        cacheHits: data.cache_hits,
        apiCalls: data.api_calls
      });

      // Refresh file history
      if (typeof FileHistory.refresh === 'function') {
        FileHistory.refresh();
      }
    } catch (err) {
      console.error('Processing error:', err);
      updateFileStatus(fileItem.id, {
        status: 'error',
        error: err.message
      });
    }
  };

  const updateFileStatus = (fileId, updates) => {
    setProcessingFiles(prev =>
      prev.map(file =>
        file.id === fileId ? { ...file, ...updates } : file
      )
    );
  };

  const handleChunkedComplete = (data) => {
    console.log('Chunked processing complete:', data);
    alert(`Processing complete! ${data.processed.toLocaleString()} records processed.\n\nCheck File History to download results.`);
    
    setChunkedProcessing(null);
    
    // Refresh file history to show the completed file
    if (typeof FileHistory.refresh === 'function') {
      FileHistory.refresh();
    }
  };

  const handleChunkedCancel = () => {
    if (confirm('Are you sure you want to cancel? Progress will be saved and you can resume later.')) {
      setChunkedProcessing(null);
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <header style={styles.header}>
          <h1 style={styles.title}>📱 Phone Number Validator</h1>
          <p style={styles.subtitle}>
            Validate US phone numbers and check iOS/iMessage support
          </p>
        </header>

        {error && (
          <div style={styles.errorBanner}>
            <span style={styles.errorIcon}>⚠️</span>
            <span style={styles.errorText}>{error}</span>
            <button 
              onClick={() => setError(null)}
              style={styles.errorClose}
            >
              ✕
            </button>
          </div>
        )}

        {/* Show chunked processor if large file is being processed */}
        {chunkedProcessing ? (
          <div style={styles.chunkedSection}>
            <div style={styles.chunkedHeader}>
              <h2 style={styles.chunkedTitle}>
                🚀 Processing Large File: {chunkedProcessing.fileName}
              </h2>
              <button
                onClick={handleChunkedCancel}
                style={styles.cancelButton}
              >
                Cancel
              </button>
            </div>
            
            <div style={styles.chunkedInfo}>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Total Records:</span>
                <span style={styles.infoValue}>{chunkedProcessing.totalRecords.toLocaleString()}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Chunk Size:</span>
                <span style={styles.infoValue}>{chunkedProcessing.chunkSize.toLocaleString()}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Est. Chunks:</span>
                <span style={styles.infoValue}>{chunkedProcessing.estimatedChunks}</span>
              </div>
              <div style={styles.infoItem}>
                <span style={styles.infoLabel}>Est. Time:</span>
                <span style={styles.infoValue}>{chunkedProcessing.estimatedTime}</span>
              </div>
            </div>

            <ChunkedProcessor
              fileId={chunkedProcessing.fileId}
              totalRecords={chunkedProcessing.totalRecords}
              service={chunkedProcessing.service}
              onComplete={handleChunkedComplete}
            />
          </div>
        ) : (
          <>
            {/* Normal file upload interface */}
            <div style={styles.uploadSection}>
              <FileUploader
                onFilesSelected={handleFilesSelected}
                disabled={processingFiles.some(f => f.status === 'processing')}
              />
              <Instructions />
            </div>

            {/* Processing queue for small files */}
            {processingFiles.length > 0 && (
              <ProcessingQueue files={processingFiles} />
            )}
          </>
        )}
        <FileProgressChecker />

        {/* File history - always visible */}
        <FileHistory />
      </div>
    </main>
  );
}

const styles = {
  main: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '40px 20px',
  },
  container: {
    maxWidth: '1000px',
    margin: '0 auto',
    background: 'white',
    borderRadius: '20px',
    padding: '40px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '40px',
  },
  title: {
    fontSize: '36px',
    fontWeight: '700',
    color: '#333',
    marginBottom: '10px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '15px 20px',
    background: '#f8d7da',
    border: '2px solid #f5c6cb',
    borderRadius: '10px',
    marginBottom: '20px',
  },
  errorIcon: {
    fontSize: '20px',
  },
  errorText: {
    flex: 1,
    color: '#721c24',
    fontSize: '14px',
    fontWeight: '500',
  },
  errorClose: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: '#721c24',
    cursor: 'pointer',
    padding: '0 5px',
  },
  chunkedSection: {
    marginBottom: '30px',
  },
  chunkedHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
    paddingBottom: '15px',
    borderBottom: '2px solid #e0e0e0',
  },
  chunkedTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  cancelButton: {
    padding: '8px 16px',
    background: '#dc3545',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  chunkedInfo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
    padding: '20px',
    background: '#f8f9fa',
    borderRadius: '10px',
    border: '2px solid #e0e0e0',
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  infoLabel: {
    fontSize: '12px',
    color: '#666',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: '18px',
    color: '#333',
    fontWeight: '700',
  },
  uploadSection: {
    marginBottom: '30px',
  },
};