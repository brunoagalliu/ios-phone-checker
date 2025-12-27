import { useState } from 'react';

export default function FileUploader() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedService, setSelectedService] = useState('blooio');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('idle'); // idle, uploading, processing, complete, error
  const [uploadMessage, setUploadMessage] = useState('');

  // Handle file selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus('idle');
      setUploadProgress(0);
      setUploadMessage('');
    }
  };

  // Handle service selection
  const handleServiceChange = (e) => {
    setSelectedService(e.target.value);
  };

  // Chunked upload for large files (> 5 MB)
  const handleLargeFileUpload = async (file, service) => {
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    console.log(`📂 Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`📦 Total chunks: ${totalChunks}`);
    
    setUploadProgress(0);
    setUploadStatus('uploading');
    setUploadMessage(`Uploading in ${totalChunks} chunks...`);
    
    let uploadId = null;
    
    try {
      // Read file as text
      const fileText = await file.text();
      
      // Upload chunks
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileText.length);
        const chunkData = fileText.slice(start, end);
        
        const formData = new FormData();
        formData.append('fileName', file.name);
        formData.append('service', service);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', totalChunks);
        formData.append('chunk', chunkData);
        
        if (uploadId) {
          formData.append('uploadId', uploadId);
        }
        
        console.log(`📤 Uploading chunk ${chunkIndex + 1}/${totalChunks}...`);
        
        const response = await fetch('/api/upload-chunk', {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          throw new Error(`Chunk ${chunkIndex + 1} failed: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
          throw new Error(data.error);
        }
        
        // Save uploadId from first chunk
        if (chunkIndex === 0) {
          uploadId = data.uploadId;
        }
        
        // Update progress
        const progress = ((chunkIndex + 1) / totalChunks * 100).toFixed(1);
        setUploadProgress(parseFloat(progress));
        setUploadMessage(`Uploading chunk ${chunkIndex + 1}/${totalChunks} (${progress}%)`);
        
        console.log(`✓ Chunk ${chunkIndex + 1}/${totalChunks} uploaded (${progress}%)`);
        
        // Check if complete
        if (data.complete) {
          console.log(`✅ Upload complete! File ID: ${uploadId}`);
          console.log(`📊 Total records: ${data.totalRecords}`);
          
          setUploadStatus('processing');
          setUploadMessage('Upload complete! Initializing processing...');
          
          // Initialize processing
          const initResponse = await fetch('/api/init-large-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileId: uploadId,
              service: service
            })
          });
          
          const initData = await initResponse.json();
          
          if (initData.success) {
            setUploadStatus('complete');
            setUploadProgress(100);
            setUploadMessage(`✅ Success! File ID: ${uploadId} | Records: ${data.totalRecords.toLocaleString()}`);
            alert(`✅ File uploaded successfully!\n\nFile ID: ${uploadId}\nRecords: ${data.totalRecords.toLocaleString()}\n\nProcessing started!`);
          } else {
            throw new Error(`Failed to initialize: ${initData.error}`);
          }
          
          break;
        }
      }
      
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus('error');
      setUploadMessage(`❌ Error: ${error.message}`);
      alert(`❌ Upload failed: ${error.message}`);
    }
  };

  // Small file upload (existing method for files < 5 MB)
  const handleSmallFileUpload = async (file, service) => {
    setUploadStatus('uploading');
    setUploadProgress(0);
    setUploadMessage('Uploading file...');
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('service', service);
      
      const response = await fetch('/api/init-large-file', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        setUploadStatus('complete');
        setUploadProgress(100);
        setUploadMessage(`✅ Success! File ID: ${data.fileId} | Records: ${data.totalRecords.toLocaleString()}`);
        alert(`✅ File uploaded successfully!\n\nFile ID: ${data.fileId}\nRecords: ${data.totalRecords.toLocaleString()}\n\nProcessing started!`);
      } else {
        throw new Error(data.error || 'Upload failed');
      }
      
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus('error');
      setUploadMessage(`❌ Error: ${error.message}`);
      alert(`❌ Upload failed: ${error.message}`);
    }
  };

  // Main upload handler
  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a file first');
      return;
    }
    
    const fileSizeMB = selectedFile.size / 1024 / 1024;
    
    console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);
    
    // Use chunked upload for files > 5 MB
    if (fileSizeMB > 5) {
      console.log(`📦 Large file detected - using chunked upload`);
      await handleLargeFileUpload(selectedFile, selectedService);
    } else {
      console.log(`📄 Small file - using direct upload`);
      await handleSmallFileUpload(selectedFile, selectedService);
    }
  };

  return (
    <div style={styles.container}>
      <h2>📤 Upload Phone Numbers</h2>
      
      {/* Service Selection */}
      <div style={styles.section}>
        <label style={styles.label}>
          Select Service:
          <select 
            value={selectedService} 
            onChange={handleServiceChange}
            style={styles.select}
            disabled={uploadStatus === 'uploading'}
          >
            <option value="blooio">Blooio</option>
            <option value="other">Other Service</option>
          </select>
        </label>
      </div>
      
      {/* File Selection */}
      <div style={styles.section}>
        <label style={styles.label}>
          Choose CSV File:
          <input 
            type="file" 
            accept=".csv" 
            onChange={handleFileChange}
            style={styles.fileInput}
            disabled={uploadStatus === 'uploading'}
          />
        </label>
      </div>
      
      {/* File Info */}
      {selectedFile && (
        <div style={styles.fileInfo}>
          <div>📄 {selectedFile.name}</div>
          <div>📊 {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
        </div>
      )}
      
      {/* Upload Button */}
      <button 
        onClick={handleUpload}
        disabled={!selectedFile || uploadStatus === 'uploading'}
        style={{
          ...styles.button,
          opacity: (!selectedFile || uploadStatus === 'uploading') ? 0.5 : 1
        }}
      >
        {uploadStatus === 'uploading' ? '⏳ Uploading...' : '🚀 Upload & Process'}
      </button>
      
      {/* Progress Bar */}
      {uploadStatus !== 'idle' && (
        <div style={styles.progressSection}>
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${uploadProgress}%`,
                background: uploadStatus === 'error' 
                  ? 'linear-gradient(90deg, #f87171 0%, #dc2626 100%)'
                  : uploadStatus === 'complete'
                  ? 'linear-gradient(90deg, #34d399 0%, #10b981 100%)'
                  : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
              }}
            />
          </div>
          <div style={styles.progressText}>
            {uploadProgress.toFixed(1)}%
          </div>
        </div>
      )}
      
      {/* Status Message */}
      {uploadMessage && (
        <div style={{
          ...styles.message,
          color: uploadStatus === 'error' ? '#dc2626' : 
                 uploadStatus === 'complete' ? '#10b981' : '#667eea'
        }}>
          {uploadMessage}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    maxWidth: '600px',
    margin: '40px auto',
    padding: '30px',
    background: '#ffffff',
    borderRadius: '12px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
  },
  section: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontWeight: '500',
    color: '#374151'
  },
  select: {
    width: '100%',
    padding: '10px',
    marginTop: '5px',
    borderRadius: '8px',
    border: '2px solid #e5e7eb',
    fontSize: '16px'
  },
  fileInput: {
    width: '100%',
    padding: '10px',
    marginTop: '5px'
  },
  fileInfo: {
    padding: '15px',
    background: '#f3f4f6',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '14px',
    color: '#6b7280'
  },
  button: {
    width: '100%',
    padding: '15px',
    background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '18px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'opacity 0.2s'
  },
  progressSection: {
    marginTop: '20px'
  },
  progressBar: {
    width: '100%',
    height: '30px',
    background: '#e5e7eb',
    borderRadius: '15px',
    overflow: 'hidden',
    marginBottom: '10px'
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: '600'
  },
  progressText: {
    textAlign: 'center',
    fontSize: '18px',
    fontWeight: '600',
    color: '#374151'
  },
  message: {
    marginTop: '15px',
    padding: '12px',
    background: '#f3f4f6',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    textAlign: 'center'
  }
};