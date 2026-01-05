import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

async function validateProcessing() {
  try {
    const pool = await getConnection();
    
    // Get latest file
    const [files] = await pool.execute(
      `SELECT id, processing_offset, processing_total FROM uploaded_files ORDER BY id DESC LIMIT 1`
    );
    
    if (files.length === 0) {
      return NextResponse.json({ success: false, error: 'No files found' });
    }
    
    const fileId = files[0].id;
    const fileProgress = files[0].processing_offset;
    const fileTotal = files[0].processing_total;
    
    // Get stats
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN supports_imessage = 1 THEN 1 ELSE 0 END) as iphones,
        SUM(CASE WHEN supports_imessage = 0 AND supports_sms = 1 THEN 1 ELSE 0 END) as androids,
        SUM(CASE WHEN contact_type = 'ERROR' THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN from_cache = 1 THEN 1 ELSE 0 END) as cached
      FROM blooio_results
      WHERE file_id = ?
    `, [fileId]);
    
    const result = stats[0];
    
    if (result.total === 0) {
      return NextResponse.json({
        success: true,
        status: 'no_data',
        message: 'Processing just started, not enough data yet',
        fileId: fileId
      });
    }
    
    const iphonePct = (result.iphones / result.total * 100);
    const androidPct = (result.androids / result.total * 100);
    const errorPct = (result.errors / result.total * 100);
    const cachePct = (result.cached / result.total * 100);
    
    const issues = [];
    
    // Validation checks
    if (iphonePct < 30) {
      issues.push({
        severity: 'HIGH',
        issue: 'Low iPhone detection',
        detail: `Only ${iphonePct.toFixed(1)}% iPhones (expected 35-55%)`,
        recommendation: 'Blooio API may be failing or cache is corrupted'
      });
    }
    
    if (iphonePct > 70) {
      issues.push({
        severity: 'MEDIUM',
        issue: 'High iPhone detection',
        detail: `${iphonePct.toFixed(1)}% iPhones (expected 35-55%)`,
        recommendation: 'Unusual but could be valid for certain datasets'
      });
    }
    
    if (errorPct > 10) {
      issues.push({
        severity: 'HIGH',
        issue: 'High error rate',
        detail: `${errorPct.toFixed(1)}% errors (expected <5%)`,
        recommendation: 'Blooio API is struggling - check rate limits or downtime'
      });
    }
    
    if (cachePct > 20 && result.total > 1000) {
      issues.push({
        severity: 'HIGH',
        issue: 'High cache usage',
        detail: `${cachePct.toFixed(1)}% from cache (expected <2% for fresh processing)`,
        recommendation: 'Old corrupted cache may still be in database'
      });
    }
    
    if (androidPct > 60) {
      issues.push({
        severity: 'MEDIUM',
        issue: 'High Android rate',
        detail: `${androidPct.toFixed(1)}% Android (expected 35-50%)`,
        recommendation: 'May indicate false negatives (iPhones marked as Android)'
      });
    }
    
    const trustScore = issues.length === 0 ? 100 : 
                       issues.filter(i => i.severity === 'HIGH').length > 0 ? 30 : 70;
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      processed: result.total,
      fileProgress: `${fileProgress} / ${fileTotal} (${((fileProgress/fileTotal)*100).toFixed(1)}%)`,
      trustScore: trustScore,
      trustLevel: trustScore >= 80 ? '✅ TRUSTWORTHY' : 
                  trustScore >= 50 ? '⚠️ QUESTIONABLE' : 
                  '❌ NOT TRUSTWORTHY',
      stats: {
        total: result.total,
        iphones: result.iphones,
        iphonePct: iphonePct.toFixed(1) + '%',
        androids: result.androids,
        androidPct: androidPct.toFixed(1) + '%',
        errors: result.errors,
        errorPct: errorPct.toFixed(1) + '%',
        cached: result.cached,
        cachePct: cachePct.toFixed(1) + '%'
      },
      issues: issues,
      recommendation: issues.length === 0 ? 
        '✅ Data looks good! Continue processing.' :
        trustScore < 50 ?
        '❌ STOP PROCESSING! Clear database and restart.' :
        '⚠️ Monitor closely. Review after 10k phones.'
    });
    
  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

// ✅ Export GET handler
export async function GET(request) {
  return validateProcessing();
}

// ✅ Also support POST
export async function POST(request) {
  return validateProcessing();
}