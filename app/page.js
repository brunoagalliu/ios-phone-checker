'use client';

import { useState } from 'react';
import FileUploader from './components/FileUploader';
import ProcessingQueue from './components/ProcessingQueue';
import FileHistory from './components/FileHistory';
import Instructions from './components/Instructions';
import FileProgressChecker from './components/FileProgressChecker';
import ActiveFiles from './components/ActiveFiles';

export default function Home() {
  const [processingFiles, setProcessingFiles] = useState([]);
  const [error, setError] = useState(null);

  const handleFilesSelected = async (files, service) => {
    setError(null);

    for (const file of files) {
      const fileSizeMB = file.size / (1024 * 1024);
      
      console.log(`File: ${file.name}, Size: ${fileSizeMB.toFixed(2)} MB, Service: ${service}`);
      
      // Parse CSV to count actual records (client-side)
      const shouldCheckRecordCount = fileSizeMB > 0.1;
      
      let actualRecordCount = 0;
      let useChunkedProcessing = false;
      
      if (shouldCheckRecordCount) {
        try {
          console.log('Counting records in file...');
          const fileText = await file.text();
          const lines = fileText.split('\n').filter(line => line.trim());
          actualRecordCount = lines.length - 1;
          
          console.log(`Actual record count: ${actualRecordCount}`);
          
          if (service === 'blooio') {
            useChunkedProcessing = actualRecordCount > 500;
          } else {
            useChunkedProcessing = actualRecordCount > 5000;
          }
          
        } catch (countError) {
          console.error('Failed to count records:', countError);
          useChunkedProcessing = fileSizeMB > 5;
        }
      }
      
      console.log(`Decision: ${useChunkedProcessing ? 'CHUNKED' : 'REGULAR'} processing`);
      
      if (useChunkedProcessing) {
        console.log(`✓ Using chunked processing for ${actualRecordCount} records`);
        
        try {
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
            console.log('✓ File initialized:', data);
            
            alert(
              `✅ ${file.name} initialized for processing!\n\n` +
              `Total records: ${data.totalRecords.toLocaleString()}\n` +
              `Chunk size: ${data.chunkSize}\n` +
              `Estimated time: ${data.estimatedTime}\n\n` +
              `Processing will start automatically via cron job.`
            );
          }
        } catch (err) {
          console.error('Failed to initialize large file:', err);
          setError(`Failed to initialize ${file.name}: ${err.message}`);
        }

        continue;
      }

      // Regular processing for small files
      console.log(`Using regular processing`);
      
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
  const handleLogout = async () => {
    if (!confirm('Are you sure you want to logout?')) return;
    
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div>
            <h1 style={styles.title}>📱 Phone Number Validator</h1>
            <p style={styles.subtitle}>
              Validate US phone numbers and check iOS/iMessage support
            </p>
          </div>
          <button onClick={handleLogout} style={styles.logoutButton}>
            🚪 Logout
          </button>
        </div>
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

        {/* Active Files - shows currently processing files */}
        <ActiveFiles />

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

        {/* Progress Checker */}
        <FileProgressChecker />

        {/* File history */}
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
  uploadSection: {
    marginBottom: '30px',
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '20px',
  },
  logoutButton: {
    padding: '10px 20px',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    whiteSpace: 'nowrap',
  },
};