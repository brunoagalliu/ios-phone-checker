'use client';

export default function Instructions() {
  return (
    <div style={styles.container}>
      <h4 style={styles.title}>📋 Service Information:</h4>
      
      <div style={styles.serviceInfo}>
        <div style={styles.serviceBlock}>
          <div style={styles.serviceName}>📱 Blooio</div>
          <ul style={styles.featureList}>
            <li>Detects iOS devices and iMessage support</li>
            <li>4 requests per second (rate limited)</li>
            <li>Best for: iOS-specific marketing campaigns</li>
            <li>Caches results for 6 months</li>
          </ul>
        </div>
        
        <div style={styles.serviceBlock}>
          <div style={styles.serviceName}>✅ SubscriberVerify</div>
          <ul style={styles.featureList}>
            <li>Validates phone number status (active/deactivated)</li>
            <li>Bulk processing: 1000 records per request</li>
            <li>Detects litigators and blacklisted numbers</li>
            <li>Carrier and geographic information</li>
            <li>Best for: Phone list cleaning and validation</li>
          </ul>
        </div>
      </div>
      
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
  serviceInfo: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '15px',
    marginBottom: '20px',
  },
  serviceBlock: {
    background: 'white',
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid #b8daff',
  },
  serviceName: {
    fontWeight: '600',
    fontSize: '14px',
    marginBottom: '8px',
    color: '#004085',
  },
  featureList: {
    margin: 0,
    paddingLeft: '20px',
    fontSize: '12px',
    lineHeight: '1.6',
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