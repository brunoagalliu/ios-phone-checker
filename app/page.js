'use client';

import { useState, useEffect } from 'react';
import FileUploader from './components/FileUploader';
import ActiveFiles from './components/ActiveFiles';
import CompletedFiles from './components/CompletedFiles';

export default function Home() {
  const [error, setError] = useState(null);
  const [cacheStats, setCacheStats] = useState(null);

  // Fetch cache stats
  useEffect(() => {
    const fetchCacheStats = async () => {
      try {
        const response = await fetch('/api/cache-stats');
        const data = await response.json();
        if (data.success) {
          setCacheStats(data.stats);
        }
      } catch (error) {
        console.error('Failed to fetch cache stats:', error);
      }
    };
    
    fetchCacheStats();
    const interval = setInterval(fetchCacheStats, 15000);
    
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    if (!confirm('Are you sure you want to logout?')) return;
    
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div style={styles.headerContent}>
            <div>
              <h1 style={styles.title}>📱 Phone Number Validator</h1>
              <p style={styles.subtitle}>
                Validate US phone numbers and check iOS/iMessage support
              </p>
            </div>
            <button onClick={handleLogout} style={styles.logoutButton}>
              🚪 Logout
            </button>
          </div>
        </header>

        {error && (
          <div style={styles.errorBanner}>
            <span style={styles.errorIcon}>⚠️</span>
            <span style={styles.errorText}>{error}</span>
            <button 
              onClick={() => setError(null)}
              style={styles.errorClose}
            >
              ✕
            </button>
          </div>
        )}

        {/* Cache Stats Widget */}
        {cacheStats && (
          <div style={styles.cacheWidget}>
            <h3 style={styles.cacheTitle}>⚡ Cache Performance</h3>
            <div style={styles.cacheGrid}>
              <div style={styles.cacheTier}>
                <div style={styles.tierIcon}>🔵</div>
                <div style={styles.tierName}>App Memory</div>
                <div style={styles.tierSpeed}>&lt;1ms</div>
                <div style={styles.tierSize}>
                  {cacheStats.memorySize ? cacheStats.memorySize.toLocaleString() : '0'} entries
                </div>
                <div style={styles.tierUsage}>
                  Hit Rate: {cacheStats.hitRate || 0}%
                </div>
              </div>
              
              <div style={styles.cacheTier}>
                <div style={styles.tierIcon}>🟢</div>
                <div style={styles.tierName}>Performance</div>
                <div style={styles.tierSpeed}>10-30ms</div>
                <div style={styles.tierSize}>
                  Hits: {cacheStats.hits ? cacheStats.hits.toLocaleString() : '0'}
                </div>
                <div style={styles.tierUsage}>
                  Misses: {cacheStats.misses ? cacheStats.misses.toLocaleString() : '0'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Active Processing Files */}
        <ActiveFiles />

        {/* File Upload Interface */}
        <div style={styles.uploadSection}>
          <FileUploader />
        </div>

        {/* Completed Files with Download */}
        <CompletedFiles />

        {/* Instructions */}
        <div style={styles.instructions}>
          <h3 style={styles.instructionsTitle}>ℹ️ How It Works</h3>
          <ul style={styles.instructionsList}>
            <li>Upload a CSV file with phone numbers in the first column</li>
            <li>Files under 5 MB: Direct upload and processing</li>
            <li>Files over 5 MB: Chunked upload (supports 500k+ records)</li>
            <li>Phone numbers are validated and checked via Blooio API</li>
            <li>Processing happens automatically in the background</li>
            <li>Results are cached to speed up future uploads</li>
            <li>Download completed results as CSV</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

const styles = {
  main: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '40px 20px',
  },
  container: {
    maxWidth: '1000px',
    margin: '0 auto',
    background: 'white',
    borderRadius: '20px',
    padding: '40px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  header: {
    marginBottom: '30px',
  },
  headerContent: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '20px',
  },
  title: {
    fontSize: '36px',
    fontWeight: '700',
    color: '#333',
    marginBottom: '10px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
  },
  logoutButton: {
    padding: '10px 20px',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    whiteSpace: 'nowrap',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '15px 20px',
    background: '#f8d7da',
    border: '2px solid #f5c6cb',
    borderRadius: '10px',
    marginBottom: '20px',
  },
  errorIcon: {
    fontSize: '20px',
  },
  errorText: {
    flex: 1,
    color: '#721c24',
    fontSize: '14px',
    fontWeight: '500',
  },
  errorClose: {
    background: 'none',
    border: 'none',
    fontSize: '20px',
    color: '#721c24',
    cursor: 'pointer',
    padding: '0 5px',
  },
  uploadSection: {
    marginBottom: '30px',
  },
  cacheWidget: {
    background: 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%)',
    padding: '25px',
    borderRadius: '15px',
    marginBottom: '30px',
    border: '2px solid #3b82f6',
    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.15)',
  },
  cacheTitle: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#1e40af',
    marginBottom: '20px',
    margin: 0,
  },
  cacheGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '15px',
  },
  cacheTier: {
    background: 'white',
    padding: '20px',
    borderRadius: '12px',
    textAlign: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  tierIcon: {
    fontSize: '32px',
    marginBottom: '10px',
  },
  tierName: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#333',
    marginBottom: '5px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tierSpeed: {
    fontSize: '12px',
    color: '#10b981',
    fontWeight: '600',
    marginBottom: '10px',
    padding: '4px 8px',
    background: '#d1fae5',
    borderRadius: '12px',
    display: 'inline-block',
  },
  tierSize: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#3b82f6',
    marginBottom: '5px',
  },
  tierUsage: {
    fontSize: '12px',
    color: '#666',
    marginTop: '5px',
  },
  instructions: {
    background: '#f9fafb',
    padding: '25px',
    borderRadius: '12px',
    marginTop: '30px',
  },
  instructionsTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#333',
    marginBottom: '15px',
    marginTop: 0,
  },
  instructionsList: {
    marginLeft: '20px',
    lineHeight: '1.8',
    color: '#666',
    fontSize: '14px',
  },
};