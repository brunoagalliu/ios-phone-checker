'use client';

import { useState } from 'react';
import Papa from 'papaparse';

export default function Home() {
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleFileUpload = (event) => {
    const uploadedFile = event.target.files[0];
    if (uploadedFile && uploadedFile.type === 'text/csv') {
      setFile(uploadedFile);
      setError(null);
      setResults(null);
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
      setError(null);
      setResults(null);
    } else {
      setError('Please upload a valid CSV file');
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
  };

  const processCSV = async () => {
    if (!file) {
      setError('Please upload a CSV file');
      return;
    }

    setProcessing(true);
    setError(null);
    setResults(null);

    try {
      // Parse CSV file
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

          // Extract phone numbers
          parseResult.data.forEach(row => {
            const phone = row[phoneColumn];
            if (phone && phone.trim()) {
              phones.push(phone.trim());
            }
          });

          if (phones.length === 0) {
            setError('No phone numbers found in the CSV file');
            setProcessing(false);
            return;
          }

          setProgress({ current: 0, total: phones.length });

          // Generate batch ID
          const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          // Send to API for processing (API key is handled server-side)
          const response = await fetch('/api/check-batch', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              phones: phones,
              batchId: batchId
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Failed to process phone numbers');
          }

          setResults(data.results);
          setProcessing(false);
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
    
    // If no exact match, return first column
    return Object.keys(firstRow)[0];
  };

  const downloadResults = () => {
    if (!results) return;

    const csv = Papa.unparse(results.map(r => ({
        phone_number: r.phone_number,
        is_ios: r.is_ios ? 'YES' : 'NO',
        supports_imessage: r.supports_imessage ? 'YES' : 'NO',
        supports_sms: r.supports_sms ? 'YES' : 'NO',
        contact_type: r.contact_type || 'N/A',
        from_cache: r.from_cache ? 'YES' : 'NO',
        cache_age_days: r.cache_age_days || 'N/A',
        source: r.source || 'N/A',
        error: r.error || 'None',
        checked_at: new Date().toISOString()
      })));

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ios_check_results_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div style={styles.body}>
      <div style={styles.container}>
        <h1 style={styles.h1}>📱 iOS Phone Number Batch Checker</h1>
        <p style={styles.subtitle}>Upload CSV, check iMessage support, download results</p>

        <div style={styles.infoBox}>
          <strong>✅ Ready to Use</strong>
          <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
            <li>API key configured on server (secure)</li>
            <li>Upload CSV with phone numbers in E.164 format (+1234567890)</li>
            <li>Column header should be: phone, phone_number, mobile, or number</li>
            <li>Processing may take a few minutes depending on file size</li>
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
              {file ? file.name : 'Click or drag CSV file here'}
            </div>
            <div style={styles.uploadHint}>
              CSV file with phone numbers
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

        {processing && (
          <div style={styles.processingBox}>
            <div style={styles.spinner}></div>
            <div style={{ marginTop: '15px', fontSize: '16px', fontWeight: '600' }}>
              Processing phone numbers...
            </div>
            <div style={{ marginTop: '10px', fontSize: '14px' }}>
              Please wait, this may take several minutes
            </div>
            <div style={{ marginTop: '5px', fontSize: '12px', color: '#666' }}>
              Rate limited to prevent API throttling
            </div>
          </div>
        )}

        {results && (
          <div style={styles.resultsBox}>
            <h3 style={styles.sectionTitle}>✅ Processing Complete!</h3>
            {/* CACHE STATISTICS */}
    {results.filter(r => r.from_cache).length > 0 && (
      <div style={{...styles.infoBox, background: '#d1ecf1', border: '1px solid #17a2b8', marginBottom: '20px'}}>
        <strong>💾 Cache Performance</strong>
        <div style={{marginTop: '10px', fontSize: '13px'}}>
          ✅ {results.filter(r => r.from_cache).length} numbers retrieved from cache<br/>
          🚀 {results.filter(r => r.from_cache).length} API calls saved<br/>
          💰 Estimated cost saved: ${(results.filter(r => r.from_cache).length * 0.01).toFixed(2)}
        </div>
      </div>
    )}


            <div style={styles.statsGrid}>
              <div style={styles.statCard}>
                <div style={styles.statNumber}>{results.length}</div>
                <div style={styles.statLabel}>Total Checked</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statNumber, color: '#007aff' }}>
                  {results.filter(r => r.is_ios).length}
                </div>
                <div style={styles.statLabel}>iOS Users</div>
              </div>
              <div style={styles.statCard}>
                <div style={{ ...styles.statNumber, color: '#3ddc84' }}>
                  {results.filter(r => !r.is_ios && !r.error).length}
                </div>
                <div style={styles.statLabel}>Non-iOS</div>
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
                      <th style={styles.th}>Phone Number</th>
                      <th style={styles.th}>iOS</th>
                      <th style={styles.th}>iMessage</th>
                      <th style={styles.th}>SMS</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.slice(0, 10).map((result, index) => (
                      <tr key={index} style={index % 2 === 0 ? styles.trEven : styles.trOdd}>
                        <td style={styles.td}>{result.phone_number}</td>
                        <td style={styles.td}>
                          <span style={result.is_ios ? styles.badgeIos : styles.badgeAndroid}>
                            {result.is_ios ? '✓ YES' : '✗ NO'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          {result.supports_imessage ? '✓' : '✗'}
                        </td>
                        <td style={styles.td}>
                          {result.supports_sms ? '✓' : '✗'}
                        </td>
                        <td style={styles.td}>
                          {result.error ? (
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

        <div style={styles.instructionsBox}>
          <h4 style={{ marginBottom: '10px' }}>📋 CSV Format Example:</h4>
          <pre style={styles.codeBlock}>
{`phone_number
+12025551234
+14155559876
+13105558765`}
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
};