import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 10;
export const dynamic = 'force-dynamic';

// Cache response for 3 seconds
let cachedResponse = null;
let cacheTime = 0;
const CACHE_TTL = 3000;

export async function GET(request) {
  try {
    const now = Date.now();
    
    // Return cached response if fresh
    if (cachedResponse && (now - cacheTime) < CACHE_TTL) {
      return NextResponse.json({
        ...cachedResponse,
        cached: true
      });
    }
    
    const connection = await getConnection();
    
    // Get ALL files that aren't completed or failed
    const [files] = await connection.execute(
      `SELECT 
        id, 
        file_name, 
        processing_status, 
        upload_status,
        processing_progress,
        processing_offset,
        processing_total,
        upload_date,
        service,
        last_error,
        CASE 
          WHEN processing_status IN ('initialized', 'paused') THEN 1
          ELSE 0
        END as can_resume
       FROM uploaded_files
       WHERE processing_status NOT IN ('completed', 'failed')
         OR (processing_status IS NULL AND upload_status = 'completed')
       ORDER BY upload_date DESC
       LIMIT 10`
    );
    
    console.log(`[active-files] Query returned ${files.length} files`);
    
    // Debug: Show what we found
    if (files.length > 0) {
      files.forEach(f => {
        console.log(`  - File ${f.id}: status="${f.processing_status}", upload="${f.upload_status}", total=${f.processing_total}`);
      });
    } else {
      console.log(`  No active files found`);
      
      // Debug: Check if file 7 exists at all
      const [allFiles] = await connection.execute(
        `SELECT id, processing_status, upload_status FROM uploaded_files ORDER BY id DESC LIMIT 5`
      );
      console.log(`  Recent files in database:`, allFiles);
    }
    
    const response = {
      success: true,
      activeFiles: files,
      count: files.length,
      timestamp: new Date().toISOString()
    };
    
    // Update cache
    cachedResponse = response;
    cacheTime = now;
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Active files error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}