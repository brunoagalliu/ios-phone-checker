import { NextResponse } from 'next/server';
import { getStatistics } from '../../../lib/db.js';

export async function GET() {
  try {
    const stats = await getStatistics();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}