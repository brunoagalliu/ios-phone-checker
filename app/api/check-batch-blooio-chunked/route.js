import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';
import { uploadFile } from '../../../lib/blobStorage.js';
import { getBlooioCacheBatch, saveBlooioCacheBatch } from '../../../lib/phoneCache.js';
import blooioRateLimiter from '../../../lib/rateLimiter.js';
import Papa from 'papaparse';

export const maxDuration = 300; // Maximum Vercel allows

const CHUNK_SIZE = 200; // Only 200 per chunk because of 4 req/sec rate limit
const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';

export async function POST(request) {
  let connection;
  
  try {
    console.log('=== BLOOIO CHUNKED PROCESSING START ===');
    console.log('Timestamp:', new Date().toISOString());
    
    // Parse request body with error handling
    let body;
    try {
      body = await request.json();
      console.log('Request body received:', JSON.stringify(body));
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return NextResponse.json({ 
        error: 'Invalid request body: ' + parseError.message 
      }, { status: 400 });
    }
    
    const { fileId, resumeFrom = 0 } = body;
    
    // Validate fileId
    if (!fileId) {
      console.error('No file ID provided');
      return NextResponse.json({ 
        error: 'File ID is required' 
      }, { status: 400 });
    }
    
    console.log(`Processing file ID: ${fileId}, resuming from offset: ${resumeFrom}`);
    
    // Get database connection
    try {
      connection = await getConnection();
      console.log('✓ Database connection established');
    } catch (dbError) {
      console.error('Database connection failed:', dbError);
      return NextResponse.json({ 
        error: 'Database connection failed: ' + dbError.message 
      }, { status: 500 });
    }
    
    // Get file metadata
    console.log('Fetching file metadata from database...');
    const [files] = await connection.execute(
      'SELECT * FROM uploaded_files WHERE id = ?',
      [fileId]
    );
    
    console.log(`Query returned ${files.length} file(s)`);
    
    if (files.length === 0) {
      console.error(`File not found with ID: ${fileId}`);
      return NextResponse.json({ 
        error: `File not found with ID: ${fileId}. Please check the file ID and try again.` 
      }, { status: 404 });
    }
    
    const fileData = files[0];
    console.log('File metadata:', {
      id: fileData.id,
      file_name: fileData.file_name,
      processing_status: fileData.processing_status,
      processing_offset: fileData.processing_offset,
      processing_total: fileData.processing_total,
      processing_progress: fileData.processing_progress,
      can_resume: fileData.can_resume,
      has_processing_state: !!fileData.processing_state,
      state_length: fileData.processing_state?.length || 0
    });
    
    const startTime = Date.now();
    
    // Parse processing state
    let processingState;
    if (!fileData.processing_state) {
      console.error('No processing_state found in file record');
      return NextResponse.json({ 
        error: 'File not initialized for chunked processing. Please re-upload the file through the chunked processor.' 
      }, { status: 400 });
    }
    
    try {
      processingState = JSON.parse(fileData.processing_state);
      console.log('Processing state parsed successfully:', {
        service: processingState.service,
        fileName: processingState.fileName,
        batchId: processingState.batchId,
        validPhonesCount: processingState.validPhones?.length || 0
      });
    } catch (stateError) {
      console.error('Failed to parse processing_state:', stateError);
      console.error('Raw processing_state (first 200 chars):', fileData.processing_state?.substring(0, 200));
      return NextResponse.json({ 
        error: 'Invalid processing state. File may be corrupted. Please re-upload the file.',
        details: stateError.message
      }, { status: 400 });
    }
    
    // Validate processing state structure
    if (!processingState.validPhones || !Array.isArray(processingState.validPhones)) {
      console.error('Invalid processing state structure - validPhones missing or not an array');
      return NextResponse.json({ 
        error: 'Invalid processing state structure. Please re-upload the file.' 
      }, { status: 400 });
    }
    
    const { validPhones, batchId, fileName } = processingState;
    const totalRecords = validPhones.length;
    const startOffset = resumeFrom;
    const endOffset = Math.min(startOffset + CHUNK_SIZE, totalRecords);
    
    console.log(`Chunk details: processing records ${startOffset} to ${endOffset} of ${totalRecords}`);
    
    if (startOffset >= totalRecords) {
      console.log('All records already processed');
      return NextResponse.json({
        success: true,
        message: 'All records already processed',
        processed: totalRecords,
        total: totalRecords,
        progress: 100,
        isComplete: true
      });
    }
    
    // Update status to processing
    console.log('Updating file status to processing...');
    await connection.execute(
      'UPDATE uploaded_files SET processing_status = ? WHERE id = ?',
      ['processing', fileId]
    );
    console.log('✓ Status updated');
    
    // Get chunk to process
    const chunk = validPhones.slice(startOffset, endOffset);
    console.log(`Extracted chunk of ${chunk.length} phone numbers`);
    
    // BATCH CACHE LOOKUP
    console.log('Performing batch cache lookup...');
    const cacheCheckStart = Date.now();
    
    const formattedPhones = chunk.map(v => `+${v.formatted}`);
    const cacheMap = await getBlooioCacheBatch(formattedPhones);
    
    const cacheCheckTime = ((Date.now() - cacheCheckStart) / 1000).toFixed(2);
    console.log(`✓ Cache check complete: ${cacheMap.size} hits out of ${chunk.length} in ${cacheCheckTime}s`);
    
    // Separate cached vs uncached
    const chunkResults = [];
    const uncachedData = [];
    let cacheHits = 0;
    let apiCalls = 0;
    
    console.log('Processing chunk records...');
    
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
        
        if ((i + 1) % 50 === 0) {
          console.log(`Processed ${i + 1}/${chunk.length} (${cacheHits} from cache)`);
        }
      } else {
        // Call API with rate limiting
        apiCalls++;
        console.log(`[${startOffset + i + 1}/${totalRecords}] Calling Blooio API for ${formattedPhone}...`);
        
        const result = await checkBlooioNumber(formattedPhone, batchId);
        
        result.original_number = validPhone.original;
        result.formatted_number = validPhone.formatted;
        result.display_number = validPhone.display;
        
        chunkResults.push(result);
        
        // Add to batch for cache save (only successful API calls)
        if (result.source === 'api' && !result.error) {
          uncachedData.push(result);
        }
        
        const status = result.error 
          ? `ERROR: ${result.error}` 
          : `${result.is_ios ? 'iOS' : 'Android'} (${result.supports_imessage ? 'iMessage' : 'SMS'})`;
        
        console.log(`  └─ Result: ${status}`);
      }
    }
    
    console.log(`Chunk processing complete: ${cacheHits} cache hits, ${apiCalls} API calls`);
    
    // BATCH SAVE TO CACHE
    if (uncachedData.length > 0) {
      console.log(`Saving ${uncachedData.length} new results to cache...`);
      const cacheSaveStart = Date.now();
      
      try {
        await saveBlooioCacheBatch(uncachedData);
        const cacheSaveTime = ((Date.now() - cacheSaveStart) / 1000).toFixed(2);
        console.log(`✓ Cache save complete in ${cacheSaveTime}s`);
      } catch (cacheError) {
        console.error('Cache save failed (non-fatal):', cacheError);
        // Continue processing even if cache save fails
      }
    }
    
    // Save chunk results to temporary storage
    console.log('Saving chunk results to processing_chunks table...');
    try {
      await connection.execute(
        `INSERT INTO processing_chunks (file_id, chunk_offset, chunk_data, created_at) 
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE chunk_data = VALUES(chunk_data), created_at = NOW()`,
        [fileId, startOffset, JSON.stringify(chunkResults)]
      );
      console.log('✓ Chunk results saved');
    } catch (chunkSaveError) {
      console.error('Failed to save chunk results:', chunkSaveError);
      return NextResponse.json({ 
        error: 'Failed to save chunk results: ' + chunkSaveError.message 
      }, { status: 500 });
    }
    
    // Update progress
    const newOffset = endOffset;
    const progress = ((newOffset / totalRecords) * 100).toFixed(2);
    const isComplete = newOffset >= totalRecords;
    
    console.log(`Updating progress: ${newOffset}/${totalRecords} (${progress}%)`);
    
    try {
      await connection.execute(
        `UPDATE uploaded_files 
         SET processing_offset = ?, 
             processing_progress = ?,
             processing_status = ?
         WHERE id = ?`,
        [newOffset, progress, isComplete ? 'finalizing' : 'processing', fileId]
      );
      console.log('✓ Progress updated');
    } catch (progressError) {
      console.error('Failed to update progress:', progressError);
      // Continue anyway
    }
    
    const elapsedTime = Date.now() - startTime;
    console.log(`Chunk processing time: ${(elapsedTime / 1000).toFixed(2)}s`);
    
    // If complete, generate final CSV
    if (isComplete) {
      console.log('=== ALL CHUNKS COMPLETE - GENERATING FINAL CSV ===');
      try {
        await generateFinalBlooioCSV(fileId, connection, fileName);
        
        await connection.execute(
          'UPDATE uploaded_files SET processing_status = ? WHERE id = ?',
          ['completed', fileId]
        );
        
        console.log('✓ Final CSV generated and file marked as completed');
      } catch (csvError) {
        console.error('Failed to generate final CSV:', csvError);
        return NextResponse.json({ 
          error: 'Failed to generate final CSV: ' + csvError.message 
        }, { status: 500 });
      }
    }
    
    console.log('=== BLOOIO CHUNKED PROCESSING END ===');
    
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
    console.error('=== BLOOIO CHUNKED PROCESSING ERROR ===');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return NextResponse.json({ 
      error: error.message || 'Internal server error',
      errorType: error.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

async function checkBlooioNumber(phoneNumber, batchId) {
  const apiKey = process.env.BLOOIO_API_KEY;
  
  if (!apiKey) {
    console.error('Blooio API key not configured');
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
          
          if (response.status === 503 && errorMessage.includes('No active devices')) {
            errorMessage = 'Blooio: No active devices available';
          }
        } catch (e) {
          try {
            errorMessage = await response.text() || errorMessage;
          } catch (textError) {
            // Use default error message
          }
        }
        
        if (response.status === 401) errorMessage = 'Invalid Blooio API key';
        if (response.status === 403) errorMessage = 'Blooio API access forbidden';
        if (response.status === 404) errorMessage = 'Phone number not found';
        if (response.status === 429) errorMessage = 'Blooio rate limit exceeded';
        
        console.warn(`  └─ API error for ${phoneNumber}: ${errorMessage}`);
        
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
    console.error(`  └─ Exception for ${phoneNumber}:`, error.message);
    
    let errorMessage = error.message;
    
    if (error.name === 'AbortError') {
      errorMessage = 'Request timeout (30s exceeded)';
    } else if (error.message.includes('fetch')) {
      errorMessage = 'Network error';
    }
    
    return {
      phone_number: phoneNumber,
      error: errorMessage,
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
      'SELECT chunk_offset, chunk_data FROM processing_chunks WHERE file_id = ? ORDER BY chunk_offset',
      [fileId]
    );
    
    console.log(`Retrieved ${chunks.length} chunks from database`);
    
    if (chunks.length === 0) {
      throw new Error('No chunks found for this file');
    }
    
    const allResults = [];
    let parseErrors = 0;
    
    chunks.forEach((chunk, index) => {
      try {
        const chunkData = JSON.parse(chunk.chunk_data);
        
        chunkData.forEach(result => {
          allResults.push({
            original_number: result.original_number || '',
            formatted_number: result.formatted_number || '',
            display_number: result.display_number || '',
            phone_number: result.phone_number || '',
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
      } catch (parseError) {
        console.error(`Failed to parse chunk ${index} (offset: ${chunk.chunk_offset}):`, parseError);
        parseErrors++;
      }
    });
    
    if (parseErrors > 0) {
      console.warn(`Warning: ${parseErrors} chunks failed to parse`);
    }
    
    console.log(`Merged ${allResults.length} total Blooio results`);
    
    if (allResults.length === 0) {
      throw new Error('No results to export');
    }
    
    // Generate CSV
    const csv = Papa.unparse(allResults);
    console.log(`Generated CSV, size: ${csv.length} bytes`);
    
    // Upload to Blob
    const resultsFileName = `${fileName.replace('.csv', '')}_blooio_results_${Date.now()}.csv`;
    const resultsBlob = await uploadFile(Buffer.from(csv), resultsFileName, 'results');
    
    console.log(`Results uploaded to: ${resultsBlob.url}`);
    
    // Update file record
    await connection.execute(
      'UPDATE uploaded_files SET results_file_url = ?, results_file_size = ? WHERE id = ?',
      [resultsBlob.url, resultsBlob.size, fileId]
    );
    
    console.log('File record updated with results URL');
    
    // Calculate stats
    const iosCount = allResults.filter(r => r.is_ios === 'YES').length;
    const errorCount = allResults.filter(r => r.error !== 'None').length;
    
    console.log(`Stats: ${iosCount} iOS devices, ${errorCount} errors`);
    
    // Clean up chunks
    await connection.execute(
      'DELETE FROM processing_chunks WHERE file_id = ?',
      [fileId]
    );
    
    console.log('Cleaned up processing chunks');
    console.log('✓ Blooio CSV generation complete');
    
  } catch (error) {
    console.error('Error generating Blooio CSV:', error);
    throw error;
  }
}