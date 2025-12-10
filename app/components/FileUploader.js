'use client';

import { useState } from 'react';

export default function FileUploader({ onFilesSelected, disabled }) {
  const [selectedService, setSelectedService] = useState('blooio'); // 'blooio' or 'subscriberverify'
  
  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    onFilesSelected(files, selectedService);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter(
      file => file.type === 'text/csv'
    );
    if (files.length > 0) {
      onFilesSelected(files, selectedService);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  return (
    <div style={styles.container}>
      <label style={styles.label}>Upload CSV Files (Multiple)</label>
      
      {/* Service Selection */}
      <div style={styles.serviceSelector}>
        <div style={styles.serviceSelectorTitle}>Choose Validation Service:</div>
        
        <div style={styles.serviceOptions}>
          <label style={{
            ...styles.serviceOption,
            ...(selectedService === 'blooio' ? styles.serviceOptionActive : {})
          }}>
            <input
              type="radio"
              name="service"
              value="blooio"
              checked={selectedService === 'blooio'}
              onChange={(e) => setSelectedService(e.target.value)}
              style={styles.radio}
            />
            <div style={styles.serviceContent}>
              <div style={styles.serviceName}>📱 Blooio</div>
              <div style={styles.serviceDescription}>
                iOS/iMessage Detection • 4 req/sec • $0.01/check
              </div>
              <div style={styles.serviceFeatures}>
                ✓ Detects iOS devices<br/>
                ✓ iMessage support check<br/>
                ✓ SMS capability check
              </div>
            </div>
          </label>

          <label style={{
            ...styles.serviceOption,
            ...(selectedService === 'subscriberverify' ? styles.serviceOptionActive : {})
          }}>
            <input
              type="radio"
              name="service"
              value="subscriberverify"
              checked={selectedService === 'subscriberverify'}
              onChange={(e) => setSelectedService(e.target.value)}
              style={styles.radio}
            />
            <div style={styles.serviceContent}>
              <div style={styles.serviceName}>✅ SubscriberVerify</div>
              <div style={styles.serviceDescription}>
                Phone Validation • 1000/request • Bulk processing
              </div>
              <div style={styles.serviceFeatures}>
                ✓ Valid/invalid detection<br/>
                ✓ Carrier identification<br/>
                ✓ Deactivation check<br/>
                ✓ Litigator detection<br/>
                ✓ Geographic data
              </div>
            </div>
          </label>
        </div>
      </div>
      
      <div
        style={styles.uploadZone}
        onClick={() => !disabled && document.getElementById('fileInput').click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div style={styles.uploadIcon}>📄</div>
        <div style={styles.uploadText}>
          Click or drag multiple CSV files here
        </div>
        <div style={styles.uploadHint}>
          Upload multiple CSV files at once
        </div>
      </div>
      <input
        id="fileInput"
        type="file"
        accept=".csv"
        multiple
        onChange={handleFileUpload}
        style={{ display: 'none' }}
        disabled={disabled}
      />
    </div>
  );
}

const styles = {
  container: {
    marginBottom: '20px',
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    color: '#555',
    fontWeight: '500',
    fontSize: '14px',
  },
  serviceSelector: {
    background: '#f8f9fa',
    padding: '20px',
    borderRadius: '12px',
    marginBottom: '20px',
    border: '2px solid #e0e0e0',
  },
  serviceSelectorTitle: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '15px',
  },
  serviceOptions: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '15px',
  },
  serviceOption: {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '15px',
    background: 'white',
    border: '2px solid #dee2e6',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  serviceOptionActive: {
    borderColor: '#667eea',
    background: '#f0f4ff',
    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.2)',
  },
  radio: {
    marginRight: '12px',
    marginTop: '3px',
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  serviceContent: {
    flex: 1,
  },
  serviceName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '5px',
  },
  serviceDescription: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '8px',
  },
  serviceFeatures: {
    fontSize: '12px',
    color: '#555',
    lineHeight: '1.6',
  },
  uploadZone: {
    border: '3px dashed #d0d0d0',
    borderRadius: '15px',
    padding: '40px',
    textAlign: 'center',
    background: '#fafafa',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
  uploadIcon: {
    fontSize: '48px',
    marginBottom: '15px',
  },
  uploadText: {
    fontSize: '16px',
    color: '#333',
    marginBottom: '5px',
    fontWeight: '500',
  },
  uploadHint: {
    fontSize: '13px',
    color: '#666',
  },
};