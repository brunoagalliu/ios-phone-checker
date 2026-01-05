import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone') || '+12012341824';
    
    // Ensure proper E.164 format
    let formattedPhone = phone;
    if (!phone.startsWith('+')) {
      formattedPhone = '+' + phone;
    }
    
    const apiUrl = `https://backend.blooio.com/v1/api/contacts/${encodeURIComponent(formattedPhone)}/capabilities`;
    
    console.log(`Testing Blooio API`);
    console.log(`Phone: ${formattedPhone}`);
    console.log(`URL: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.BLOOIO_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`Status: ${response.status}`);
    
    const responseText = await response.text();
    console.log('Raw response:', responseText);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return NextResponse.json({
        success: false,
        error: 'Failed to parse JSON',
        rawResponse: responseText,
        status: response.status,
        url: apiUrl
      });
    }
    
    // If error response
    if (data.error || data.message || response.status >= 400) {
      return NextResponse.json({
        success: false,
        phone: formattedPhone,
        url: apiUrl,
        status: response.status,
        error: data.error || 'API Error',
        message: data.message || data.error || 'Unknown error',
        rawResponse: data
      });
    }
    
    const capabilities = data?.capabilities || {};
    const supportsIMessage = capabilities.imessage === true;
    const supportsSMS = capabilities.sms === true;
    
    return NextResponse.json({
      success: true,
      phone: formattedPhone,
      url: apiUrl,
      status: response.status,
      rawResponse: data,
      parsed: {
        supportsIMessage: supportsIMessage,
        supportsSMS: supportsSMS,
        contactType: supportsIMessage ? 'iPhone' : (supportsSMS ? 'Android' : 'Unknown')
      }
    });
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}