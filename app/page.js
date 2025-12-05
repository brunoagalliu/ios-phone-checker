'use client';

import { useState, useEffect } from 'react';
import Papa from 'papaparse';

export default function Home() {
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [validationResults, setValidationResults] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [showHistory, setShowHistory] = useState(false);

  // Load file history on mount
  useEffect(() => {
    loadFileHistory();
  }, []);

  const loadFileHistory = async () => {
    try {
      const response = await fetch('/api/files');
      const data = await response.json();
      if (data.success) {
        setUploadedFiles(data.files);
      }
    } catch (err) {
      console.error('Failed to load file history:', err);
    }
  };

  const handleFileUpload = (event) => {
    const uploadedFile = event.target.files[0];
    if (uploadedFile && uploadedFile.type === 'text/csv') {
      setFile(uploadedFile);
      setFileName(uploadedFile.name);
      setError(null);
      setResults(null);
      setValidationResults(null);
    } else {
      setError('Please upload a valid CSV file');
      setFile(null);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const droppedFile = event.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'text/csv') {
      setFile(droppedFile);
      setFileName(droppedFile.name);
      setError(null);
      setResults(null);
      setValidationResults(null);
    } else {
      setError('Please upload a valid CSV file');
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const findPhoneColumn = (data) => {
    if (data.length === 0) return null;
    
    const firstRow = data[0];
    const possibleColumns = ['phone', 'phone_number', 'phonenumber', 'mobile', 'number', 'cell', 'telephone'];
    
    for (const col of Object.keys(firstRow)) {
      const lowerCol = col.toLowerCase().trim();
      if (possibleColumns.includes(lowerCol)) {
        return col;
      }
    }
    
    return Object.keys(firstRow)[0];
  };

  const processCSV = async () => {
    if (!file) {
      setError('Please upload a CSV file');
      return;
    }

    setProcessing(true);
    setError(null);
    setResults(null);
    setValidationResults(null);

    try {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (parseResult) => {
          const phones = [];
          const phoneColumn = findPhoneColumn(parseResult.data);

          if (!phoneColumn) {
            setError('Could not find phone number column. Please ensure your CSV has a column named "phone", "phone_number", "mobile", or "number"');
            setProcessing(false);
            return;
          }

          parseResult.data.forEach(row => {
            const phone = row[phoneColumn];
            if (phone) {
              phones.push(phone.toString().trim());
            }
          });

          if (phones.length === 0) {
            setError('No phone numbers found in the CSV file');
            setProcessing(false);
            return;
          }

          const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          const response = await fetch('/api/check-batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              phones: phones,
              batchId: batchId,
              fileName: fileName
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Failed to process phone numbers');
          }

          setValidationResults(data.validation);
          setResults(data.results);
          setProcessing(false);
          
          // Reload file history
          loadFileHistory();
        },
        error: (error) => {
          setError(`CSV parsing error: ${error.message}`);
          setProcessing(false);
        }
      });
    } catch (err) {
      setError(err.message || 'An error occurred while processing');
      setProcessing(false);
    }
  };

  const downloadResults = () => {
    if (!results) return;

    const csv = Papa.unparse(results.map(r => ({
      original_number: r.original_number || r.phone_number,
      formatted_number: r.formatted_number || r.phone_number,
      display_number: r.display_number || r.phone_number,
      is_ios: r.is_ios ? 'YES' : 'NO',
      supports_imessage: r.supports_imessage ? 'YES' : 'NO',
      supports_sms: r.supports_sms ? 'YES' : 'NO',
      from_cache: r.from_cache ? 'YES' : 'NO',
      cache_age_days: r.cache_age_days || 'N/A',
      error: r.error || 'None',
      checked_at: new Date().toISOString()
    })));

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName.replace('.csv', '')}_results_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const downloadFileResults = async (batchId, originalName) => {
    try {
      const response = await fetch(`/api/files?batchId=${batchId}`);
      const data = await response.json();
      
      if (data.success && data.results) {
        const csv = Papa.unparse(data.results.map(r => ({
          phone_number: r.phone_number,
          is_ios: r.is_ios ? 'YES' : 'NO',
          supports_imessage: r.supports_imessage ? 'YES' : 'NO',
          supports_sms: r.supports_sms ? 'YES' : 'NO',
          error: r.error || 'None',
          checked_at: r.last_checked
        })));

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${originalName.replace('.csv', '')}_results.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert('Failed to download file results');
    }
  };

  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <h1 style={styles.h1}>📱 iOS Phone Number Batch Checker</h1>
        <p style={styles.subtitle}>US numbers only • Validates • Deduplicates • Checks iOS</p>

        <div style={styles.infoBox}>
          <strong>✅ Smart Processing</strong>
          <ul style={{ marginTop: '10px', paddingLeft: '20px', fontSize: '12px' }}>
            <li>Validates US phone numbers (proper area codes & format)</li>
            <li>Auto-formats to: 1 + 10 digits (e.g., 18503631955)</li>
            <li>Removes duplicates, blanks, and invalid numbers</li>
            <li>Caches results for 6 months (saves API calls)</li>
            <li>Stores all files in database for later download</li>
          </ul>
        </div>

        <div style={styles.inputGroup}>
          <label style={styles.label}>Upload CSV File</label>
          <div
            style={styles.uploadZone}
            onClick={() => document.getElementById('fileInput').click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <div style={styles.uploadIcon}>📄</div>
            <div style={styles.uploadText}>
              {file ? fileName : 'Click or drag CSV file here'}
            </div>
            <div style={styles.uploadHint}>
              CSV with phone numbers (any format accepted)
            </div>
          </div>
          <input
            id="fileInput"
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>

        {error && (
          <div style={styles.errorBox}>
            ❌ {error}
          </div>
        )}

        {validationResults && (
          <div style={styles.validationBox}>
            <h3 style={styles.sectionTitle}>📊 Validation Results</h3>
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{validationResults.total}</div>
                <div style={styles.statLabel}>Total Uploaded</div>
              </div>
              <div style={{ ...styles.statCard, background: '#d4edda' }}>
                <div style={{ ...styles.statNumber, color: '#28a745' }}>
                  {validationResults.valid}
                </div>
                <div style={styles.statLabel}>✓ Valid US Numbers</div>
              </div>
              <div style={{ ...styles.statCard, background: '#f8d7da' }}>
                <div style={{ ...styles.statNumber, color: '#dc3545' }}>
                  {validationResults.invalid}
                </div>
                <div style={styles.statLabel}>✗ Invalid</div>
              </div>
              <div style={{ ...styles.statCard, background: '#fff3cd' }}>
                <div style={{ ...styles.statNumber, color: '#856404' }}>
                  {validationResults.duplicates}
                </div>
                <div style={styles.statLabel}>⚠ Duplicates</div>
              </div>
            </div>
          </div>
        )}

        {processing && (
          <div style={styles.processingBox}>
            <div style={styles.spinner}></div>
            <div style={{ marginTop: '15px', fontSize: '16px', fontWeight: '600' }}>
              Processing phone numbers...
            </div>
            <div style={{ marginTop: '10px', fontSize: '14px' }}>
              Validating, formatting, and checking iOS status
            </div>
          </div>
        )}

        {results && (
          <div style={styles.resultsBox}>
            <h3 style={styles.sectionTitle}>✅ Processing Complete!</h3>
            
            {results.filter(r => r.from_cache).length > 0 && (
              <div style={{...styles.infoBox, background: '#d1ecf1', border: '1px solid #17a2b8', marginBottom: '20px'}}>
                <strong>💾 Cache Performance</strong>
                <div style={{marginTop: '10px', fontSize: '13px'}}>
                  ✅ {results.filter(r => r.from_cache).length} numbers from cache<br/>
                  🚀 {results.filter(r => r.from_cache).length} API calls saved<br/>
                  💰 Cost saved: ${(results.filter(r => r.from_cache).length * 0.01).toFixed(2)}
                </div>
              </div>
            )}
            
            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{results.length}</div>
                <div style={styles.statLabel}>Checked</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statNumber, color: '#007aff' }}>
                  {results.filter(r => r.is_ios).length}
                </div>
                <div style={styles.statLabel}>iOS Users</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statNumber, color: '#17a2b8' }}>
                  {results.filter(r => r.from_cache).length}
                </div>
                <div style={styles.statLabel}>From Cache</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statNumber, color: '#dc3545' }}>
                  {results.filter(r => r.error).length}
                </div>
                <div style={styles.statLabel}>Errors</div>
              </div>
            </div>

            <button onClick={downloadResults} style={styles.downloadButton}>
              ⬇️ Download Results CSV
            </button>

            <div style={styles.previewSection}>
              <h4 style={{ marginBottom: '15px' }}>Preview (first 10 results)</h4>
              <div style={styles.tableContainer}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Original</th>
                      <th style={styles.th}>Formatted</th>
                      <th style={styles.th}>iOS</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.slice(0, 10).map((result, index) => (
                      <tr key={index} style={index % 2 === 0 ? styles.trEven : styles.trOdd}>
                        <td style={styles.td}>{result.original_number || result.phone_number}</td>
                        <td style={styles.td}>{result.formatted_number || result.phone_number}</td>
                        <td style={styles.td}>
                          <span style={result.is_ios ? styles.badgeIos : styles.badgeAndroid}>
                            {result.is_ios ? '✓ YES' : '✗ NO'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {result.from_cache ? (
                            <span style={styles.badgeCache}>Cache</span>
                          ) : result.error ? (
                            <span style={styles.badgeError}>Error</span>
                          ) : (
                            <span style={styles.badgeSuccess}>Success</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {results.length > 10 && (
                <div style={{ marginTop: '10px', fontSize: '13px', color: '#666', textAlign: 'center' }}>
                  Showing first 10 of {results.length} results. Download CSV for complete data.
                </div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={processCSV}
          disabled={processing || !file}
          style={{
            ...styles.button,
            ...(processing || !file ? styles.buttonDisabled : {})
          }}
        >
          {processing ? 'Processing...' : '🚀 Start Processing'}
        </button>

        {/* FILE HISTORY SECTION */}
        <div style={styles.historySection}>
          <button 
            onClick={() => setShowHistory(!showHistory)}
            style={styles.historyToggle}
          >
            📂 {showHistory ? 'Hide' : 'Show'} File History ({uploadedFiles.length})
          </button>
          
          {showHistory && uploadedFiles.length > 0 && (
            <div style={styles.historyList}>
              {uploadedFiles.map((file, index) => (
                <div key={file.id} style={styles.historyItem}>
                  <div style={styles.historyInfo}>
                    <div style={styles.historyName}>{file.original_name}</div>
                    <div style={styles.historyMeta}>
                      Uploaded: {new Date(file.upload_date).toLocaleString()} •
                      Valid: {file.valid_numbers} •
                      Invalid: {file.invalid_numbers} •
                      Status: <span style={file.processing_status === 'completed' ? {color: '#28a745', fontWeight: '600'} : {}}>{file.processing_status}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => downloadFileResults(file.batch_id, file.original_name)}
                    style={{
                      ...styles.historyDownload,
                      ...(file.processing_status !== 'completed' ? {opacity: 0.5, cursor: 'not-allowed'} : {})
                    }}
                    disabled={file.processing_status !== 'completed'}
                  >
                    ⬇️ Download
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {showHistory && uploadedFiles.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666', fontSize: '14px' }}>
              No files uploaded yet
            </div>
          )}
        </div>

        <div style={styles.instructionsBox}>
          <h4 style={{ marginBottom: '10px' }}>📋 Accepted Phone Formats:</h4>
          <pre style={styles.codeBlock}>
{`phone_number
8503631955
(850) 363-1955
850-363-1955
1-850-363-1955
+1 (850) 363-1955

All will be formatted to: 18503631955`}
          </pre>
          <div style={{ marginTop: '10px', fontSize: '12px' }}>
            <strong>Supported column names:</strong> phone, phone_number, mobile, number, cell, telephone
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

const styles = {
  body: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  container: {
    background: 'white',
    borderRadius: '20px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    maxWidth: '900px',
    width: '100%',
    padding: '40px',
  },
  h1: {
    color: '#333',
    fontSize: '28px',
    marginBottom: '10px',
    textAlign: 'center',
  },
  subtitle: {
    color: '#666',
    textAlign: 'center',
    marginBottom: '30px',
    fontSize: '14px',
  },
  infoBox: {
    background: '#d4edda',
    border: '1px solid #28a745',
    borderRadius: '10px',
    padding: '15px',
    marginBottom: '20px',
    fontSize: '13px',
    color: '#155724',
  },
  inputGroup: {
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
  button: {
    width: '100%',
    padding: '14px 24px',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    transition: 'all 0.3s',
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  errorBox: {
    background: '#f8d7da',
    border: '2px solid #dc3545',
    borderRadius: '10px',
    padding: '15px',
    marginBottom: '20px',
    color: '#721c24',
  },
  validationBox: {
    background: '#e7f3ff',
    border: '2px solid #17a2b8',
    borderRadius: '10px',
    padding: '25px',
    marginBottom: '20px',
  },
  processingBox: {
    background: '#d1ecf1',
    border: '2px solid #17a2b8',
    borderRadius: '10px',
    padding: '30px',
    marginBottom: '20px',
    textAlign: 'center',
    color: '#0c5460',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid rgba(0, 0, 0, 0.1)',
    borderTop: '4px solid #17a2b8',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto',
  },
  resultsBox: {
    background: '#d4edda',
    border: '2px solid #28a745',
    borderRadius: '10px',
    padding: '25px',
    marginBottom: '20px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '15px',
    margin: '20px 0',
  },
  statCard: {
    background: 'white',
    borderRadius: '8px',
    padding: '20px',
    textAlign: 'center',
  },
  statNumber: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '5px',
  },
  statLabel: {
    fontSize: '13px',
    color: '#666',
  },
  downloadButton: {
    width: '100%',
    padding: '14px 24px',
    border: 'none',
    borderRadius: '10px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    background: '#28a745',
    color: 'white',
    marginBottom: '20px',
  },
  previewSection: {
    marginTop: '20px',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    marginBottom: '15px',
  },
  tableContainer: {
    overflowX: 'auto',
    border: '1px solid #ddd',
    borderRadius: '8px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '14px',
  },
  th: {
    background: '#f8f9fa',
    padding: '12px',
    textAlign: 'left',
    fontWeight: '600',
    borderBottom: '2px solid #dee2e6',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #dee2e6',
  },
  trEven: {
    background: 'white',
  },
  trOdd: {
    background: '#f8f9fa',
  },
  badgeIos: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#007aff',
    color: 'white',
  },
  badgeAndroid: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#6c757d',
    color: 'white',
  },
  badgeSuccess: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#28a745',
    color: 'white',
  },
  badgeError: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#dc3545',
    color: 'white',
  },
  badgeCache: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '600',
    background: '#17a2b8',
    color: 'white',
  },
  instructionsBox: {
    background: '#e7f3ff',
    borderRadius: '8px',
    padding: '15px',
    marginTop: '20px',
    fontSize: '13px',
    color: '#004085',
  },
  codeBlock: {
    background: '#f8f9fa',
    padding: '10px',
    borderRadius: '5px',
    fontSize: '12px',
    overflow: 'auto',
  },
  historySection: {
    marginTop: '30px',
    borderTop: '2px solid #e0e0e0',
    paddingTop: '20px',
  },
  historyToggle: {
    width: '100%',
    padding: '12px',
    background: '#f8f9fa',
    border: '2px solid #dee2e6',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
    color: '#333',
  },
  historyList: {
    marginTop: '15px',
  },
  historyItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '15px',
    background: '#f8f9fa',
    borderRadius: '8px',
    marginBottom: '10px',
    border: '1px solid #dee2e6',
  },
  historyInfo: {
    flex: 1,
  },
  historyName: {
    fontWeight: '600',
    color: '#333',
    marginBottom: '5px',
    fontSize: '14px',
  },
  historyMeta: {
    fontSize: '12px',
    color: '#666',
  },
  historyDownload: {
    padding: '8px 16px',
    background: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s',
  },
};