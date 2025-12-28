'use client';

import { useState } from 'react';

export default function FileUploaderSimple() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedService, setSelectedService] = useState('blooio');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('idle');
  const [uploadMessage, setUploadMessage] = useState('');

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus('idle');
      setUploadProgress(0);
      setUploadMessage('');
    }
  };

  const handleServiceChange = (e) => {
    setSelectedService(e.target.value);
  };

  const handleLargeFileUpload = async (file, service) => {
    const LINES_PER_CHUNK = 50000;
    
    console.log(`📂 Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    setUploadProgress(0);
    setUploadStatus('uploading');
    setUploadMessage(`Reading file...`);
    
    let uploadId = null;
    
    try {
      const fileText = await file.text();
      const allLines = fileText.trim().split('\n');
      
      if (allLines.length < 2) {
        throw new Error('File must contain at least a header and one data row');
      }
      
      const header = allLines[0];
      const dataLines = allLines.slice(1);
      const totalChunks = Math.ceil(dataLines.length / LINES_PER_CHUNK);
      
      console.log(`📦 Total lines: ${dataLines.length.toLocaleString()}`);
      console.log(`📦 Total chunks: ${totalChunks}`);
      
      setUploadMessage(`Uploading ${totalChunks} chunks...`);
      
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * LINES_PER_CHUNK;
        const end = Math.min(start + LINES_PER_CHUNK, dataLines.length);
        const chunkLines = dataLines.slice(start, end);
        
        let chunkData;
        if (chunkIndex === 0) {
          chunkData = header + '\n' + chunkLines.join('\n');
        } else {
          chunkData = chunkLines.join('\n');
        }
        
        const formData = new FormData();
        formData.append('fileName', file.name);
        formData.append('service', service);
        formData.append('chunkIndex', chunkIndex);
        formData.append('totalChunks', totalChunks);
        formData.append('chunk', chunkData);
        formData.append('hasHeader', chunkIndex === 0 ? 'true' : 'false');
        
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
        
        if (chunkIndex === 0) {
          uploadId = data.uploadId;
        }
        
        const progress = ((chunkIndex + 1) / totalChunks * 100).toFixed(1);
        setUploadProgress(parseFloat(progress));
        setUploadMessage(`Uploading chunk ${chunkIndex + 1}/${totalChunks} (${progress}%)`);
        
        console.log(`✓ Chunk ${chunkIndex + 1}/${totalChunks} uploaded (${progress}%)`);
        
        if (data.complete) {
          console.log(`✅ Upload complete! File ID: ${uploadId}`);
          console.log(`📊 Total records: ${data.totalRecords.toLocaleString()}`);
          
          setUploadStatus('processing');
          setUploadMessage('Upload complete! Initializing processing...');
          
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

  const handleUpload = async () => {
    if (!selectedFile) {
      alert('Please select a file first');
      return;
    }
    
    const fileSizeMB = selectedFile.size / 1024 / 1024;
    
    console.log(`File size: ${fileSizeMB.toFixed(2)} MB`);
    
    if (fileSizeMB > 5) {
      console.log(`📦 Large file detected - using chunked upload`);
      await handleLargeFileUpload(selectedFile, selectedService);
    } else {
      console.log(`📄 Small file - using direct upload`);
      await handleSmallFileUpload(selectedFile, selectedService);
    }
  };

  return (
    <div style={{
      maxWidth: '600px',
      margin: '40px auto',
      padding: '30px',
      background: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
    }}>
      <h2>📤 Upload Phone Numbers</h2>
      
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
          Select Service:
          <select 
            value={selectedService} 
            onChange={handleServiceChange}
            style={{
              width: '100%',
              padding: '10px',
              marginTop: '5px',
              borderRadius: '8px',
              border: '2px solid #e5e7eb',
              fontSize: '16px'
            }}
            disabled={uploadStatus === 'uploading'}
          >
            <option value="blooio">Blooio</option>
          </select>
        </label>
      </div>
      
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
          Choose CSV File:
          <input 
            type="file" 
            accept=".csv" 
            onChange={handleFileChange}
            style={{ width: '100%', padding: '10px', marginTop: '5px' }}
            disabled={uploadStatus === 'uploading'}
          />
        </label>
      </div>
      
      {selectedFile && (
        <div style={{
          padding: '15px',
          background: '#f3f4f6',
          borderRadius: '8px',
          marginBottom: '20px',
          fontSize: '14px'
        }}>
          <div>📄 {selectedFile.name}</div>
          <div>📊 {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
        </div>
      )}
      
      <button 
        onClick={handleUpload}
        disabled={!selectedFile || uploadStatus === 'uploading'}
        style={{
          width: '100%',
          padding: '15px',
          background: (!selectedFile || uploadStatus === 'uploading') 
            ? '#9ca3af' 
            : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '18px',
          fontWeight: '600',
          cursor: (!selectedFile || uploadStatus === 'uploading') ? 'not-allowed' : 'pointer'
        }}
      >
        {uploadStatus === 'uploading' ? '⏳ Uploading...' : '🚀 Upload & Process'}
      </button>
      
      {uploadStatus !== 'idle' && (
        <div style={{ marginTop: '20px' }}>
          <div style={{
            width: '100%',
            height: '30px',
            background: '#e5e7eb',
            borderRadius: '15px',
            overflow: 'hidden',
            marginBottom: '10px'
          }}>
            <div 
              style={{
                height: '100%',
                width: `${uploadProgress}%`,
                background: uploadStatus === 'error' 
                  ? 'linear-gradient(90deg, #f87171 0%, #dc2626 100%)'
                  : uploadStatus === 'complete'
                  ? 'linear-gradient(90deg, #34d399 0%, #10b981 100%)'
                  : 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                transition: 'width 0.3s ease'
              }}
            />
          </div>
          <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: '600' }}>
            {uploadProgress.toFixed(1)}%
          </div>
        </div>
      )}
      
      {uploadMessage && (
        <div style={{
          marginTop: '15px',
          padding: '12px',
          background: '#f3f4f6',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          textAlign: 'center',
          color: uploadStatus === 'error' ? '#dc2626' : 
                 uploadStatus === 'complete' ? '#10b981' : '#667eea'
        }}>
          {uploadMessage}
        </div>
      )}
    </div>
  );
}