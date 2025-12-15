import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { uploadFile } from '../../../lib/blobStorage.js';
import { getBlooioCacheBatch, saveBlooioCacheBatch } from '../../../lib/phoneCache.js';
import blooioRateLimiter from '../../../lib/rateLimiter.js';
import Papa from 'papaparse';

export const maxDuration = 60; // Maximum Vercel allows

const CHUNK_SIZE = 200; // Only 200 per chunk because of 4 req/sec rate limit
const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';

export async function POST(request) {
  let connection;
  
  try {
    const body = await request.json();
    const { fileId, resumeFrom = 0 } = body;
    
    connection = await getConnection();
    
    // Get file metadata
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    if (files.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const fileData = files[0];
    const startTime = Date.now();
    
    // Parse processing state
    let processingState;
    if (fileData.processing_state) {
      processingState = JSON.parse(fileData.processing_state);
    } else {
      return NextResponse.json({ 
        error: 'File not initialized. Please upload file first.' 
      }, { status: 400 });
    }
    
    const { validPhones, batchId, fileName } = processingState;
    const totalRecords = validPhones.length;
    const startOffset = resumeFrom;
    const endOffset = Math.min(startOffset + CHUNK_SIZE, totalRecords);
    
    console.log(`Processing Blooio chunk: ${startOffset} to ${endOffset} of ${totalRecords}`);
    
    // Update status to processing
    await connection.execute(
      'UPDATE uploaded_files SET processing_status = ? WHERE id = ?',
      ['processing', fileId]
    );
    
    // Get chunk to process
    const chunk = validPhones.slice(startOffset, endOffset);
    
    // BATCH CACHE LOOKUP
    const formattedPhones = chunk.map(v => `+${v.formatted}`);
    const cacheMap = await getBlooioCacheBatch(formattedPhones);
    
    console.log(`Blooio chunk cache: ${cacheMap.size} hits out of ${chunk.length}`);
    
    // Separate cached vs uncached
    const chunkResults = [];
    const uncachedData = [];
    let cacheHits = 0;
    let apiCalls = 0;
    
    for (let i = 0; i < chunk.length; i++) {
      const validPhone = chunk[i];
      const formattedPhone = `+${validPhone.formatted}`;
      const cached = cacheMap.get(formattedPhone);
      
      if (cached) {
        // Use cached result
        cacheHits++;
        chunkResults.push({
          original_number: validPhone.original,
          formatted_number: validPhone.formatted,
          display_number: validPhone.display,
          phone_number: formattedPhone,
          is_ios: cached.is_ios,
          supports_imessage: cached.supports_imessage,
          supports_sms: cached.supports_sms,
          contact_type: cached.contact_type,
          contact_id: cached.contact_id,
          from_cache: true,
          cache_age_days: cached.cache_age_days,
          error: null
        });
      } else {
        // Call API with rate limiting
        apiCalls++;
        const result = await checkBlooioNumber(formattedPhone, batchId);
        
        result.original_number = validPhone.original;
        result.formatted_number = validPhone.formatted;
        result.display_number = validPhone.display;
        
        chunkResults.push(result);
        
        // Add to batch for cache save (only successful API calls)
        if (result.source === 'api' && !result.error) {
          uncachedData.push(result);
        }
        
        console.log(`[${startOffset + i + 1}/${totalRecords}] ${validPhone.formatted} - ${result.is_ios ? 'iOS' : 'Android/Other'}`);
      }
    }
    
    // BATCH SAVE TO CACHE
    if (uncachedData.length > 0) {
      await saveBlooioCacheBatch(uncachedData);
      console.log(`Saved ${uncachedData.length} results to cache`);
    }
    
    // Save chunk results to temporary storage
    await connection.execute(
      `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE chunk_data = VALUES(chunk_data)`,
      [fileId, startOffset, JSON.stringify(chunkResults)]
    );
    
    // Update progress
    const newOffset = endOffset;
    const progress = ((newOffset / totalRecords) * 100).toFixed(2);
    const isComplete = newOffset >= totalRecords;
    
    await connection.execute(
      `UPDATE uploaded_files 
       SET processing_offset = ?, 
           processing_progress = ?,
           processing_status = ?
       WHERE id = ?`,
      [newOffset, progress, isComplete ? 'finalizing' : 'processing', fileId]
    );
    
    const elapsedTime = Date.now() - startTime;
    console.log(`Blooio chunk processed in ${(elapsedTime / 1000).toFixed(2)}s`);
    
    // If complete, generate final CSV
    if (isComplete) {
      console.log('All chunks processed. Generating final CSV...');
      await generateFinalBlooioCSV(fileId, connection, fileName);
      
      await connection.execute(
        'UPDATE uploaded_files SET processing_status = ? WHERE id = ?',
        ['completed', fileId]
      );
    }
    
    return NextResponse.json({
      success: true,
      fileId: fileId,
      processed: newOffset,
      total: totalRecords,
      progress: parseFloat(progress),
      isComplete: isComplete,
      chunkSize: endOffset - startOffset,
      cacheHits: cacheHits,
      apiCalls: apiCalls,
      elapsedSeconds: (elapsedTime / 1000).toFixed(2)
    });
    
  } catch (error) {
    console.error('Blooio chunked processing error:', error);
    return NextResponse.json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

async function checkBlooioNumber(phoneNumber, batchId) {
  const apiKey = process.env.BLOOIO_API_KEY;
  
  if (!apiKey) {
    return {
      phone_number: phoneNumber,
      error: 'Blooio API key not configured',
      is_ios: false,
      supports_imessage: false,
      supports_sms: false,
      from_cache: false,
      source: 'config_error'
    };
  }
  
  try {
    const result = await blooioRateLimiter.execute(async () => {
      const response = await fetch(
        `${BLOOIO_API_URL}/${encodeURIComponent(phoneNumber)}/capabilities`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(30000)
        }
      );
      
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          errorMessage = await response.text() || errorMessage;
        }
        
        return {
          phone_number: phoneNumber,
          error: errorMessage,
          is_ios: false,
          supports_imessage: false,
          supports_sms: false,
          from_cache: false,
          source: 'api_error'
        };
      }
      
      const data = await response.json();
      const capabilities = data.capabilities || {};
      const supportsIMessage = capabilities.imessage === true || capabilities.iMessage === true;
      const supportsSMS = capabilities.sms === true || capabilities.SMS === true;
      
      return {
        phone_number: phoneNumber,
        contact_id: data.contact,
        contact_type: data.contact_type,
        is_ios: supportsIMessage,
        supports_imessage: supportsIMessage,
        supports_sms: supportsSMS,
        last_checked_at: data.last_checked_at,
        error: null,
        from_cache: false,
        source: 'api',
        batch_id: batchId
      };
    });
    
    return result;
    
  } catch (error) {
    return {
      phone_number: phoneNumber,
      error: error.message,
      is_ios: false,
      supports_imessage: false,
      supports_sms: false,
      from_cache: false,
      source: 'network_error'
    };
  }
}

async function generateFinalBlooioCSV(fileId, connection, fileName) {
  try {
    console.log(`Generating final Blooio CSV for file ${fileId}...`);
    
    const [chunks] = await connection.execute(
      'SELECT chunk_data FROM processing_chunks WHERE file_id = ? ORDER BY chunk_offset',
      [fileId]
    );
    
    const allResults = [];
    chunks.forEach(chunk => {
      const chunkData = JSON.parse(chunk.chunk_data);
      chunkData.forEach(result => {
        allResults.push({
          original_number: result.original_number,
          formatted_number: result.formatted_number,
          display_number: result.display_number,
          phone_number: result.phone_number,
          is_ios: result.is_ios ? 'YES' : 'NO',
          supports_imessage: result.supports_imessage ? 'YES' : 'NO',
          supports_sms: result.supports_sms ? 'YES' : 'NO',
          contact_type: result.contact_type || '',
          contact_id: result.contact_id || '',
          from_cache: result.from_cache ? 'YES' : 'NO',
          cache_age_days: result.cache_age_days || '',
          error: result.error || 'None',
          checked_at: new Date().toISOString()
        });
      });
    });
    
    console.log(`Merged ${allResults.length} Blooio results`);
    
    const csv = Papa.unparse(allResults);
    
    const resultsFileName = `${fileName.replace('.csv', '')}_blooio_results_${Date.now()}.csv`;
    const resultsBlob = await uploadFile(Buffer.from(csv), resultsFileName, 'results');
    
    await connection.execute(
      'UPDATE uploaded_files SET results_file_url = ?, results_file_size = ? WHERE id = ?',
      [resultsBlob.url, resultsBlob.size, fileId]
    );
    
    // Clean up chunks
    await connection.execute(
      'DELETE FROM processing_chunks WHERE file_id = ?',
      [fileId]
    );
    
    console.log(`Blooio CSV generation complete`);
    
  } catch (error) {
    console.error('Error generating Blooio CSV:', error);
    throw error;
  }
}