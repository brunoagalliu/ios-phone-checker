export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('fileId');
  
  if (!fileId) {
    return new Response('File ID required', { status: 400 });
  }
  
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      const connection = await getConnection();
      
      // Send updates every 2 seconds
      const interval = setInterval(async () => {
        try {
          const [files] = await connection.execute(
            'SELECT processing_offset, processing_total, processing_progress FROM uploaded_files WHERE id = ?',
            [fileId]
          );
          
          if (files.length > 0) {
            const data = JSON.stringify({
              offset: files[0].processing_offset,
              total: files[0].processing_total,
              progress: files[0].processing_progress
            });
            
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            
            // Close if complete
            if (files[0].processing_offset >= files[0].processing_total) {
              clearInterval(interval);
              controller.close();
            }
          }
        } catch (error) {
          console.error('Stream error:', error);
          clearInterval(interval);
          controller.close();
        }
      }, 2000);
      
      // Close after 5 minutes
      setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 300000);
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}