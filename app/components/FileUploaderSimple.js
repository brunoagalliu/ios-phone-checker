'use client';

import { useState } from 'react';

export default function FileUploaderSimple() {
  const [selectedFile, setSelectedFile] = useState(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  return (
    <div style={{ 
      maxWidth: '600px', 
      margin: '40px auto', 
      padding: '30px',
      background: '#ffffff',
      borderRadius: '12px'
    }}>
      <h2>Upload Phone Numbers</h2>
      
      <input 
        type="file" 
        accept=".csv" 
        onChange={handleFileChange}
        style={{ padding: '10px' }}
      />
      
      {selectedFile && (
        <div style={{ marginTop: '20px' }}>
          <p>Selected: {selectedFile.name}</p>
          <p>Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
        </div>
      )}
    </div>
  );
}