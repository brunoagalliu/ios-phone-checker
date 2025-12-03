import { NextResponse } from 'next/server';
import { savePhoneCheck } from '../../../lib/db.js';

const BLOOIO_API_URL = 'https://backend.blooio.com/v1/api/contacts';
const RATE_LIMIT_DELAY = parseInt(process.env.RATE_LIMIT_DELAY_MS) || 500;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatPhoneNumber(phone) {
  let formatted = phone.toString().trim().replace(/[^\d+]/g, '');
  
  if (!formatted.startsWith('+')) {
    formatted = '+' + formatted;
  }
  
  return formatted;
}

function isValidE164(phone) {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

async function checkSingleNumber(phoneNumber) {
  const formattedPhone = formatPhoneNumber(phoneNumber);
  
  if (!isValidE164(formattedPhone)) {
    return {
      phone_number: phoneNumber,
      error: 'Invalid phone number format',
      is_ios: false,
      supports_imessage: false,
      supports_sms: false
    };
  }
  
  // Get API key from environment variable (server-side only)
  const apiKey = process.env.BLOOIO_API_KEY;
  
  if (!apiKey) {
    return {
      phone_number: formattedPhone,
      error: 'Server configuration error: API key not set',
      is_ios: false,
      supports_imessage: false,
      supports_sms: false
    };
  }
  
  try {
    const response = await fetch(
      `${BLOOIO_API_URL}/${encodeURIComponent(formattedPhone)}/capabilities`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    
    const capabilities = data.capabilities || {};
    const supportsIMessage = capabilities.imessage === true || capabilities.iMessage === true;
    const supportsSMS = capabilities.sms === true || capabilities.SMS === true;
    
    return {
      phone_number: formattedPhone,
      contact_id: data.contact,
      contact_type: data.contact_type,
      is_ios: supportsIMessage,
      supports_imessage: supportsIMessage,
      supports_sms: supportsSMS,
      last_checked: data.last_checked_at,
      error: null
    };
    
  } catch (error) {
    console.error(`Error checking ${formattedPhone}:`, error.message);
    return {
      phone_number: formattedPhone,
      error: error.message,
      is_ios: false,
      supports_imessage: false,
      supports_sms: false
    };
  }
}

export async function POST(request) {
  try {
    const { phones, batchId } = await request.json();
    
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return NextResponse.json(
        { error: 'Phone numbers array is required' },
        { status: 400 }
      );
    }
    
    const results = [];
    const total = phones.length;
    
    for (let i = 0; i < phones.length; i++) {
      const phone = phones[i];
      
      const result = await checkSingleNumber(phone);
      result.batch_id = batchId;
      
      try {
        await savePhoneCheck(result);
      } catch (dbError) {
        console.error('Database save error:', dbError);
        result.db_error = 'Failed to save to database';
      }
      
      results.push(result);
      
      console.log(`Processed ${i + 1}/${total}: ${phone}`);
      
      if (i < phones.length - 1) {
        await delay(RATE_LIMIT_DELAY);
      }
    }
    
    return NextResponse.json({
      success: true,
      batch_id: batchId,
      total_processed: results.length,
      results: results
    });
    
  } catch (error) {
    console.error('Batch check error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}