import { NextResponse } from 'next/server';
import { checkCredits as checkSubscriberVerifyCredits } from '../../../lib/subscriberVerify.js';

export async function GET() {
  try {
    const credits = {
      subscriberVerify: null,
      error: null
    };
    
    // Check SubscriberVerify credits
    try {
      credits.subscriberVerify = await checkSubscriberVerifyCredits();
    } catch (error) {
      console.error('SubscriberVerify credits check failed:', error);
      credits.error = error.message;
    }
    
    return NextResponse.json({
      success: true,
      credits: credits
    });
    
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}