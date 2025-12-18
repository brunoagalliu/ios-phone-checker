import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { uploadFile } from '../../../lib/blobStorage.js';

export const maxDuration = 300;

export async function POST(request) {
  try {
    const { fileId } = await request.json();
    
    if (!fileId) {
      return NextResponse.json({ error: 'File ID required' }, { status: 400 });
    }
    
    console.log(`Generating results file for File ${fileId}...`);
    
    const connection = await getConnection();
    
    // Get file info
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const file = files[0];
    
    console.log(`File: ${file.file_name}, Status: ${file.processing_status}`);
    
    // Get all chunk data
    const [chunks] = await connection.execute(
      'SELECT chunk_offset, chunk_data FROM processing_chunks WHERE file_id = ? ORDER BY chunk_offset ASC',
      [fileId]
    );
    
    if (chunks.length === 0) {
      return NextResponse.json({ 
        error: 'No processing data found. File may not have been processed yet.' 
      }, { status: 404 });
    }
    
    console.log(`Found ${chunks.length} chunks to compile`);
    
    // Compile results from all chunks
    let allResults = [];
    let totalRecords = 0;
    
    for (const chunk of chunks) {
      try {
        const chunkData = JSON.parse(chunk.chunk_data);
        allResults = allResults.concat(chunkData);
        totalRecords += chunkData.length;
      } catch (parseError) {
        console.error(`Error parsing chunk at offset ${chunk.chunk_offset}:`, parseError);
      }
    }
    
    console.log(`Total records compiled: ${totalRecords}`);
    
    if (allResults.length === 0) {
      return NextResponse.json({ 
        error: 'No valid results found in chunks' 
      }, { status: 404 });
    }
    
    // Generate CSV
    const csvHeader = 'phone_number,is_ios,supports_imessage,supports_sms,contact_type,contact_id,error,from_cache\n';
    
    const csvRows = allResults.map(result => {
      // Convert undefined to empty string, null to empty string
      const safeValue = (val) => {
        if (val === undefined || val === null) return '';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        return String(val);
      };
      
      return [
        safeValue(result.phone_number || result.e164),
        result.is_ios ? 'true' : 'false',
        result.supports_imessage ? 'true' : 'false',
        result.supports_sms ? 'true' : 'false',
        safeValue(result.contact_type),
        safeValue(result.contact_id),
        safeValue(result.error),
        result.from_cache ? 'true' : 'false'
      ].join(',');
    }).join('\n');
    
    const csvContent = csvHeader + csvRows;
    const csvBuffer = Buffer.from(csvContent, 'utf-8');
    
    console.log(`Generated CSV: ${csvBuffer.length} bytes, ${totalRecords} records`);
    
    // Upload to blob storage
    const timestamp = Date.now();
    const baseFileName = file.file_name || file.original_name || `file_${fileId}`;
    const resultsFileName = `results_${baseFileName}_${timestamp}.csv`;
    
    console.log(`Uploading to blob storage: ${resultsFileName}`);
    
    const resultsBlob = await uploadFile(csvBuffer, resultsFileName, 'results');
    
    console.log(`Uploaded results to: ${resultsBlob.url}`);
    
    // Update file record with results URL (use null for undefined values)
    const resultsUrl = resultsBlob.url || null;
    const resultsSize = resultsBlob.size || 0;
    
    await connection.execute(
      `UPDATE uploaded_files 
       SET results_file_url = ?,
           results_file_size = ?
       WHERE id = ?`,
      [resultsUrl, resultsSize, fileId]
    );
    
    console.log(`✓ Results file generated successfully`);
    
    return NextResponse.json({
      success: true,
      resultsUrl: resultsUrl,
      totalRecords: totalRecords,
      fileSize: resultsSize,
      fileName: resultsFileName
    });
    
  } catch (error) {
    console.error('Generate results error:', error);
    console.error('Error stack:', error.stack);
    
    return NextResponse.json({
      success: false,
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
}