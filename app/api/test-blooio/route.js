import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone') || '+12012341824';
    
    console.log(`Testing Blooio API for: ${phone}`);
    
    const response = await fetch(
      `https://backend.blooio.com/v1/api/contacts/${encodeURIComponent(phone)}/capabilities`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${process.env.BLOOIO_API_KEY}`
        }
      }
    );
    
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
        status: response.status
      });
    }
    
    const capabilities = data?.capabilities || {};
    const supportsIMessage = capabilities.imessage === true;
    const supportsSMS = capabilities.sms === true;
    
    return NextResponse.json({
      success: true,
      phone: phone,
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
      error: error.message
    }, { status: 500 });
  }
}