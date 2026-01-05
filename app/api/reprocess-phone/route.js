import { NextResponse } from 'next/server';
import { getConnection } from '../../../lib/db.js';

export const maxDuration = 60;

export async function POST(request) {
  try {
    const { phone, fileId } = await request.json();
    
    if (!phone || !fileId) {
      return NextResponse.json({
        success: false,
        error: 'phone and fileId required'
      }, { status: 400 });
    }
    
    // Format phone
    const e164 = phone.startsWith('+') ? phone : '+' + phone;
    
    console.log(`🔄 Reprocessing ${e164} for file ${fileId}`);
    
    const pool = await getConnection();
    
    // Delete existing result
    await pool.execute(
      `DELETE FROM blooio_results WHERE file_id = ? AND e164 = ?`,
      [fileId, e164]
    );
    
    // Delete from cache
    await pool.execute(
      `DELETE FROM blooio_cache WHERE e164 = ?`,
      [e164]
    );
    
    console.log(`   Deleted old data`);
    
    // Call Blooio API immediately
    console.log(`   Calling Blooio API...`);
    
    const response = await fetch(
      `https://backend.blooio.com/v2/api/contacts/${encodeURIComponent(e164)}/capabilities`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.BLOOIO_API_KEY}`
        },
        signal: AbortSignal.timeout(15000)
      }
    );
    
    if (!response.ok) {
      throw new Error(`Blooio API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log(`   API Response:`, JSON.stringify(data));
    
    if (!data.capabilities) {
      throw new Error('Invalid API response - missing capabilities');
    }
    
    const capabilities = data.capabilities;
    const supportsIMessage = capabilities.imessage === true;
    const supportsSMS = capabilities.sms === true;
    const contactType = supportsIMessage ? 'iPhone' : (supportsSMS ? 'Android' : 'Unknown');
    
    console.log(`   Result: ${contactType} (iMessage: ${supportsIMessage})`);
    
    // Save to results
    await pool.execute(
      `INSERT INTO blooio_results 
       (file_id, phone_number, e164, is_ios, supports_imessage, supports_sms, contact_type, error, from_cache)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
      [
        fileId,
        e164.substring(1), // Remove + for phone_number
        e164,
        supportsIMessage ? 1 : 0,
        supportsIMessage ? 1 : 0,
        supportsSMS ? 1 : 0,
        contactType
      ]
    );
    
    // Save to cache
    await pool.execute(
      `INSERT INTO blooio_cache 
       (e164, is_ios, supports_imessage, supports_sms, contact_type)
       VALUES (?, ?, ?, ?, ?)`,
      [
        e164,
        supportsIMessage ? 1 : 0,
        supportsIMessage ? 1 : 0,
        supportsSMS ? 1 : 0,
        contactType
      ]
    );
    
    console.log(`   ✅ Saved to database`);
    
    return NextResponse.json({
      success: true,
      phone: e164,
      result: {
        supportsIMessage: supportsIMessage,
        supportsSMS: supportsSMS,
        contactType: contactType
      },
      message: 'Phone reprocessed successfully'
    });
    
  } catch (error) {
    console.error('Reprocess error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}