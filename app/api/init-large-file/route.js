import { NextResponse } from 'next/server';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { getConnection } from '../../../lib/db.js';
import { uploadFile } from '../../../lib/blobStorage.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = formData.get('fileName');
    const service = formData.get('service') || 'blooio';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    console.log(`Initializing large file: ${fileName}`);
    console.log(`Service: ${service}`);

    // Read and parse CSV
    const fileBuffer = await file.arrayBuffer();
    const fileContent = Buffer.from(fileBuffer).toString('utf-8');
    const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line);

    console.log(`Total lines in file: ${lines.length}`);

    // Parse and validate phone numbers
    const validPhones = [];
    const invalidPhones = [];
    const duplicatePhones = [];
    const seenNumbers = new Set();

    // Skip header if exists
    const startIndex = lines[0].match(/phone|number|mobile/i) ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      const phoneNumber = line.split(',')[0].trim();

      if (!phoneNumber) continue;

      try {
        if (isValidPhoneNumber(phoneNumber, 'US')) {
          const parsed = parsePhoneNumber(phoneNumber, 'US');
          const e164 = parsed.format('E.164');

          if (seenNumbers.has(e164)) {
            duplicatePhones.push(phoneNumber);
          } else {
            seenNumbers.add(e164);
            validPhones.push({
              original: phoneNumber,
              e164: e164
            });
          }
        } else {
          invalidPhones.push(phoneNumber);
        }
      } catch (error) {
        invalidPhones.push(phoneNumber);
      }
    }

    console.log(`Valid: ${validPhones.length}, Invalid: ${invalidPhones.length}, Duplicates: ${duplicatePhones.length}`);

    if (validPhones.length === 0) {
      return NextResponse.json({
        error: 'No valid phone numbers found in file'
      }, { status: 400 });
    }

    // Upload original file to blob storage
    const originalBlob = await uploadFile(fileBuffer, fileName, 'uploads');

    // Generate batch ID
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create processing state
    const processingState = {
      validPhones: validPhones,
      batchId: batchId,
      fileName: fileName,
      service: service,
      uploadedAt: new Date().toISOString()
    };

    // Save to database
    const connection = await getConnection();

    const totalNumbers = lines.length - startIndex;
    const validCount = validPhones.length;
    const invalidCount = invalidPhones.length;
    const duplicateCount = duplicatePhones.length;
    const originalFileName = fileName;

    await connection.execute(
      `INSERT INTO uploaded_files (
        file_name, original_name, batch_id, total_numbers, 
        valid_numbers, invalid_numbers, duplicate_numbers,
        processing_status, processing_offset, processing_total,
        processing_progress, processing_state, can_resume, 
        original_file_url, upload_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        fileName,
        originalFileName,
        batchId,
        totalNumbers,
        validCount,
        invalidCount,
        duplicateCount,
        'initialized',
        0,
        validCount,
        0,
        JSON.stringify(processingState),
        1, // ✅ can_resume = 1
        originalBlob.url
      ]
    );

    const [result] = await connection.execute(
      'SELECT LAST_INSERT_ID() as fileId'
    );

    const fileId = result[0].fileId;

    console.log(`✓ File initialized with ID: ${fileId}`);

    // ✅ AUTO-TRIGGER FIRST CHUNK
    console.log('🚀 Auto-triggering first chunk...');

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://ios.smsapp.co';


    // Trigger processing without waiting
    fetch(`${baseUrl}/api/check-batch-blooio-chunked`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        fileId: fileId, 
        resumeFrom: 0 
      })
    }).catch(err => {
      console.error('Auto-trigger failed:', err.message);
      // Not critical - cron will pick it up
    });

    console.log('✓ First chunk triggered');

    // Calculate estimates
    const chunkSize = service === 'blooio' ? 250 : 1000;
    const totalChunks = Math.ceil(validCount / chunkSize);
    const estimatedMinutes = Math.ceil(totalChunks * 0.5); // Assume 30s per chunk avg

    return NextResponse.json({
      success: true,
      fileId: fileId,
      batchId: batchId,
      fileName: fileName,
      totalRecords: validCount,
      totalNumbers: totalNumbers,
      validNumbers: validCount,
      invalidNumbers: invalidCount,
      duplicateNumbers: duplicateCount,
      chunkSize: chunkSize,
      totalChunks: totalChunks,
      estimatedTime: `${estimatedMinutes} minutes`,
      message: 'File initialized and processing started automatically',
      originalFileUrl: originalBlob.url
    });

  } catch (error) {
    console.error('Init large file error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}