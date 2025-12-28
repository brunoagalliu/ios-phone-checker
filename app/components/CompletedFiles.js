'use client';

import { useState, useEffect, useCallback } from 'react';

export default function CompletedFiles() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchCompletedFiles = useCallback(async () => {
    try {
      const response = await fetch('/api/completed-files');
      const data = await response.json();
      
      if (data.success && Array.isArray(data.files)) {
        setFiles(data.files);
      }
    } catch (error) {
      console.error('Failed to fetch completed files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompletedFiles();
  }, [fetchCompletedFiles]);

  const handleDownload = async (fileId, fileName) => {
    try {
      const response = await fetch(`/api/download-results?fileId=${fileId}`);
      
      if (!response.ok) {
        throw new Error('Download failed');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `results_${fileName}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert(`Failed to download: ${error.message}`);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div>🔄 Loading history...</div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={{
        maxWidth: '800px',
        margin: '20px auto',
        padding: '20px',
        background: '#f9fafb',
        borderRadius: '12px',
        textAlign: 'center',
        color: '#6b7280'
      }}>
        <p>No completed files yet. Upload a file to get started!</p>
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: '800px',
      margin: '20px auto',
      padding: '20px',
      background: '#ffffff',
      borderRadius: '12px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
    }}>
      <h3 style={{ marginTop: 0 }}>📋 Processing History</h3>
      
      {files.map(file => {
        if (!file || !file.id) return null;
        
        const uploadDate = new Date(file.upload_date).toLocaleString();
        
        return (
          <div key={file.id} style={{
            background: '#f9fafb',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '15px',
            border: '1px solid #e5e7eb'
          }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'flex-start',
              marginBottom: '10px'
            }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '5px' }}>
                  {file.file_name || 'Unknown File'}
                </div>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  File ID: {file.id} • Uploaded: {uploadDate}
                </div>
                <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '5px' }}>
                  Total Records: {(file.processing_total || 0).toLocaleString()}
                </div>
              </div>
              
              <div style={{
                padding: '6px 12px',
                background: '#d1fae5',
                color: '#065f46',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500'
              }}>
                ✓ Completed
              </div>
            </div>
            
            <button
              onClick={() => handleDownload(file.id, file.file_name)}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                marginTop: '10px'
              }}
            >
              ⬇️ Download Results CSV
            </button>
          </div>
        );
      })}
    </div>
  );
}