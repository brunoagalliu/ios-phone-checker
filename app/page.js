'use client';

import FileUploader from './components/FileUploader';
import ActiveFiles from './components/ActiveFiles';
import CompletedFiles from './components/CompletedFiles';

export default function Home() {
  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ 
        textAlign: 'center', 
        marginBottom: '40px',
        fontSize: '32px',
        fontWeight: '700',
        color: '#1f2937'
      }}>
        📱 Phone Number Validation System
      </h1>
      
      {/* Active Processing */}
      <ActiveFiles />
      
      {/* Upload New File */}
      <FileUploader />
      
      {/* Completed Files History */}
      <CompletedFiles />
      
      {/* Info Section */}
      <div style={{
        maxWidth: '800px',
        margin: '40px auto',
        padding: '20px',
        background: '#f9fafb',
        borderRadius: '8px',
        fontSize: '14px',
        color: '#6b7280'
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '10px' }}>
          ℹ️ How It Works
        </h3>
        <ul style={{ marginLeft: '20px', lineHeight: '1.8' }}>
          <li>Upload a CSV file with phone numbers (first column)</li>
          <li>Files under 5 MB: Direct upload</li>
          <li>Files over 5 MB: Chunked upload (supports 500k+ records)</li>
          <li>Phone numbers are validated and checked via Blooio API</li>
          <li>Processing happens automatically in the background</li>
          <li>Download results as CSV when processing completes</li>
        </ul>
      </div>
    </div>
  );
}