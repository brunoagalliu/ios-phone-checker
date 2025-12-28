'use client';

import FileUploader from './components/FileUploader';
import ActiveFiles from './components/ActiveFiles';

export default function Home() {
  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center', marginBottom: '40px' }}>
        📱 Phone Number Validation System
      </h1>
      
      <ActiveFiles />
      <FileUploader />
    </div>
  );
}