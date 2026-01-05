import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    const pool = await getConnection();
    
    // Get stats
    const [stats] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN supports_imessage = 1 THEN 1 ELSE 0 END) as iphones,
        SUM(CASE WHEN supports_imessage = 0 AND supports_sms = 1 THEN 1 ELSE 0 END) as androids,
        SUM(CASE WHEN supports_imessage = 0 AND supports_sms = 0 THEN 1 ELSE 0 END) as unknown,
        SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) as errors,
        SUM(CASE WHEN contact_type = 'ERROR' THEN 1 ELSE 0 END) as marked_errors
      FROM blooio_results
      WHERE file_id = ?
    `, [fileId]);
    
    const result = stats[0];
    const iphonePct = (result.iphones / result.total * 100).toFixed(2);
    const androidPct = (result.androids / result.total * 100).toFixed(2);
    const unknownPct = (result.unknown / result.total * 100).toFixed(2);
    const errorPct = (result.errors / result.total * 100).toFixed(2);
    
    const warnings = [];
    
    // ✅ Check for unrealistic iOS rate
    if (iphonePct < 30 || iphonePct > 70) {
      warnings.push(`⚠️ iOS rate ${iphonePct}% is outside expected range (30-70%)`);
    }
    
    // ✅ Check for high error rate
    if (errorPct > 10) {
      warnings.push(`⚠️ High error rate: ${errorPct}%`);
    }
    
    // ✅ Check for too many unknowns
    if (unknownPct > 15) {
      warnings.push(`⚠️ High unknown rate: ${unknownPct}%`);
    }
    
    return NextResponse.json({
      success: true,
      fileId,
      stats: {
        total: result.total,
        iphones: result.iphones,
        androids: result.androids,
        unknown: result.unknown,
        errors: result.errors
      },
      percentages: {
        iphones: iphonePct + '%',
        androids: androidPct + '%',
        unknown: unknownPct + '%',
        errors: errorPct + '%'
      },
      warnings: warnings,
      healthy: warnings.length === 0
    });
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}