'use client';

export default function Instructions() {
  return (
    <div style={styles.container}>
      <h4 style={styles.title}>📋 Accepted Phone Formats:</h4>
      <pre style={styles.codeBlock}>
{`phone_number
8503631955
(850) 363-1955
850-363-1955
1-850-363-1955
+1 (850) 363-1955

All will be formatted to: 18503631955`}
      </pre>
      <div style={styles.note}>
        <strong>Supported column names:</strong> phone, phone_number, mobile, number, cell, telephone
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: '#e7f3ff',
    borderRadius: '8px',
    padding: '15px',
    marginTop: '20px',
    fontSize: '13px',
    color: '#004085',
  },
  title: {
    marginBottom: '10px',
    fontSize: '14px',
    fontWeight: '600',
  },
  codeBlock: {
    background: '#f8f9fa',
    padding: '10px',
    borderRadius: '5px',
    fontSize: '12px',
    overflow: 'auto',
  },
  note: {
    marginTop: '10px',
    fontSize: '12px',
  },
};