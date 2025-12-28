import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');
    
    if (!fileId) {
      return NextResponse.json({
        success: false,
        error: 'File ID is required'
      }, { status: 400 });
    }
    
    const connection = await getConnection();
    
    // Get file info
    const [files] = await connection.execute(
      `SELECT * FROM uploaded_files WHERE id = ?`,
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'File not found'
      }, { status: 404 });
    }
    
    const file = files[0];
    
    // Get results
    const [results] = await connection.execute(
      `SELECT 
        phone_number,
        e164,
        is_ios,
        supports_imessage,
        supports_sms,
        contact_type,
        error,
        from_cache
       FROM blooio_results
       WHERE file_id = ?
       ORDER BY id ASC`,
      [fileId]
    );
    
    // Generate CSV
    const csvHeader = 'Phone Number,E164,Is iOS,Supports iMessage,Supports SMS,Contact Type,Error,From Cache\n';
    const csvRows = results.map(r => 
      `${r.phone_number},${r.e164},${r.is_ios ? 'Yes' : 'No'},${r.supports_imessage ? 'Yes' : 'No'},${r.supports_sms ? 'Yes' : 'No'},${r.contact_type || ''},${r.error || ''},${r.from_cache ? 'Yes' : 'No'}`
    ).join('\n');
    
    const csv = csvHeader + csvRows;
    
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="results_${file.file_name}"`
      }
    });
    
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}