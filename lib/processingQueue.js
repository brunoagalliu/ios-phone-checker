class ProcessingQueue {
    constructor() {
      this.queue = [];
      this.processing = false;
      this.currentFile = null;
      this.listeners = [];
    }
  
    /**
     * Add file to queue and start processing if not already running
     */
    add(fileInfo) {
      this.queue.push({
        ...fileInfo,
        addedAt: Date.now(),
        status: 'queued'
      });
      
      console.log(`📋 Added to queue: ${fileInfo.fileName}`);
      console.log(`   Queue length: ${this.queue.length}`);
      
      this.notifyListeners();
      
      if (!this.processing) {
        this.processNext();
      }
    }
  
    /**
     * Process next file in queue
     */
    async processNext() {
      if (this.queue.length === 0) {
        this.processing = false;
        this.currentFile = null;
        console.log('✅ Queue empty - all files processed');
        this.notifyListeners();
        return;
      }
  
      this.processing = true;
      const fileInfo = this.queue.shift();
      this.currentFile = fileInfo;
      
      console.log(`\n🚀 Starting: ${fileInfo.fileName}`);
      console.log(`   File ID: ${fileInfo.fileId}`);
      console.log(`   Total records: ${fileInfo.totalRecords.toLocaleString()}`);
      console.log(`   Service: ${fileInfo.service}`);
      console.log(`   Remaining in queue: ${this.queue.length}\n`);
  
      this.notifyListeners();
  
      try {
        await this.processFile(fileInfo);
        console.log(`✅ Completed: ${fileInfo.fileName}\n`);
      } catch (error) {
        console.error(`❌ Failed: ${fileInfo.fileName}`, error);
        // Continue to next file even if this one failed
      }
  
      // Small delay before next file
      await new Promise(r => setTimeout(r, 2000));
      
      // Process next file
      this.processNext();
    }
  
    /**
     * Process a single file through all its chunks
     */
    async processFile(fileInfo) {
      const { fileId, totalRecords, service } = fileInfo;
      let currentOffset = 0;
      let chunkCount = 0;
      const startTime = Date.now();
  
      const apiEndpoint = service === 'blooio' 
        ? '/api/check-batch-blooio-chunked' 
        : '/api/check-batch-chunked';
  
      while (currentOffset < totalRecords) {
        chunkCount++;
        
        console.log(`  [Chunk ${chunkCount}] Processing ${currentOffset.toLocaleString()}-${Math.min(currentOffset + fileInfo.chunkSize, totalRecords).toLocaleString()}...`);
  
        try {
          const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId, resumeFrom: currentOffset })
          });
  
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
  
          const data = await response.json();
  
          if (!data.success) {
            throw new Error(data.error || 'Processing failed');
          }
  
          const progressPct = ((data.processed / data.total) * 100).toFixed(1);
          const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
          
          console.log(`  ✓ Chunk ${chunkCount} complete`);
          console.log(`    Progress: ${data.processed.toLocaleString()}/${data.total.toLocaleString()} (${progressPct}%)`);
          console.log(`    Cache: ${data.cacheHits}, API: ${data.apiCalls}`);
          console.log(`    Elapsed: ${elapsedMin} min\n`);
  
          currentOffset = data.processed;
  
          // Update current file progress for UI
          if (this.currentFile) {
            this.currentFile.currentOffset = currentOffset;
            this.currentFile.progress = parseFloat(progressPct);
            this.notifyListeners();
          }
  
          if (data.isComplete) {
            const totalMin = ((Date.now() - startTime) / 60000).toFixed(1);
            console.log(`\n🎉 File complete in ${totalMin} minutes!`);
            break;
          }
  
          // Small delay between chunks
          await new Promise(r => setTimeout(r, 1000));
  
        } catch (error) {
          console.error(`  ❌ Chunk ${chunkCount} failed:`, error.message);
          throw error; // Re-throw to mark file as failed
        }
      }
    }
  
    /**
     * Subscribe to queue updates
     */
    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      };
    }
  
    /**
     * Notify all listeners of queue changes
     */
    notifyListeners() {
      const status = this.getStatus();
      this.listeners.forEach(listener => listener(status));
    }
  
    /**
     * Get current queue status
     */
    getStatus() {
      return {
        queueLength: this.queue.length,
        isProcessing: this.processing,
        currentFile: this.currentFile ? {
          fileName: this.currentFile.fileName,
          fileId: this.currentFile.fileId,
          totalRecords: this.currentFile.totalRecords,
          currentOffset: this.currentFile.currentOffset || 0,
          progress: this.currentFile.progress || 0,
          service: this.currentFile.service
        } : null,
        nextFiles: this.queue.map(f => ({
          fileName: f.fileName,
          fileId: f.fileId,
          totalRecords: f.totalRecords
        }))
      };
    }
  
    /**
     * Clear the queue (emergency stop)
     */
    clear() {
      this.queue = [];
      this.notifyListeners();
      console.log('🛑 Queue cleared');
    }
  }
  
  // Singleton instance
  const queue = new ProcessingQueue();
  
  // Make it available in browser console for debugging
  if (typeof window !== 'undefined') {
    window.processingQueue = queue;
  }
  
  export default queue;