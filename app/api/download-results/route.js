import { NextResponse } from 'next/server';
import { executeWithRetry } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');
    
    if (!fileId) {
      return NextResponse.json({ error: 'fileId required' }, { status: 400 });
    }
    
    // Get all results
    const [results] = await executeWithRetry(
      `SELECT phone_number, e164, supports_imessage, supports_sms, contact_type, error
       FROM blooio_results
       WHERE file_id = ?
       ORDER BY id ASC`,
      [fileId]
    );
    
    if (results.length === 0) {
      return NextResponse.json({ error: 'No results found' }, { status: 404 });
    }
    
    // Generate CSV
    const headers = ['phone_number', 'e164', 'supports_imessage', 'supports_sms', 'contact_type', 'error'];
    const csvRows = [headers.join(',')];
    
    for (const row of results) {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        // Escape commas and quotes
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      csvRows.push(values.join(','));
    }
    
    const csv = csvRows.join('\n');
    
    // Get filename
    const [fileInfo] = await executeWithRetry(
      `SELECT file_name FROM uploaded_files WHERE id = ?`,
      [fileId]
    );
    
    const filename = fileInfo[0]?.file_name || `results_${fileId}.csv`;
    const resultsFilename = filename.replace('.csv', '_results.csv');
    
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${resultsFilename}"`,
        'Cache-Control': 'no-cache',
      },
    });
    
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}