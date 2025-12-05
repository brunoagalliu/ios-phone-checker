'use client';

export default function FileUploader({ onFilesSelected, disabled }) {
  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    onFilesSelected(files);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter(
      file => file.type === 'text/csv'
    );
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  return (
    <div style={styles.container}>
      <label style={styles.label}>Upload CSV Files (Multiple)</label>
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