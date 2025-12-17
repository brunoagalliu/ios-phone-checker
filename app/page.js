'use client';

import { useState } from 'react';
import FileUploader from './components/FileUploader';
import ProcessingQueue from './components/ProcessingQueue';
import FileHistory from './components/FileHistory';
import Instructions from './components/Instructions';
import FileProgressChecker from './components/FileProgressChecker';
import QueueMonitor from './components/QueueMonitor';
import processingQueue from '../lib/processingQueue';
import ActiveFiles from './components/ActiveFiles';

export default function Home() {
  const [processingFiles, setProcessingFiles] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => {
    // Warm up database connection on page load
    fetch('/api/warmup').catch(err => console.log('Warmup failed:', err));
  }, []);

  const handleFilesSelected = async (files, service) => {
    setError(null);

    for (const file of files) {
      const fileSizeMB = file.size / (1024 * 1024);
      
      console.log(`File: ${file.name}, Size: ${fileSizeMB.toFixed(2)} MB, Service: ${service}`);
      
      // Parse CSV to count actual records
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
            // Add to processing queue
            processingQueue.add({
              fileId: data.fileId,
              fileName: file.name,
              totalRecords: data.totalRecords,
              service: data.service,
              chunkSize: data.chunkSize,
              estimatedChunks: data.estimatedChunks,
              estimatedTime: data.estimatedTime
            });
            
            console.log('✓ File added to processing queue:', data);
            
            // Show success message
            alert(`✅ ${file.name} added to processing queue!\n\n` +
                  `Total records: ${data.totalRecords.toLocaleString()}\n` +
                  `Estimated time: ${data.estimatedTime}\n\n` +
                  `Processing will start automatically.`);
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
    // ... existing processFile code (unchanged)
  };

  const updateFileStatus = (fileId, updates) => {
    setProcessingFiles(prev =>
      prev.map(file =>
        file.id === fileId ? { ...file, ...updates } : file
      )
    );
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

        {/* Queue Monitor - shows current processing status */}
        <QueueMonitor />

        {/* Active Files Dashboard */}
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
const styleSheet = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;