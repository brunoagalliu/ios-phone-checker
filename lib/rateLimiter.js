/**
 * Rate Limiter for Blooio API
 * Limits to configurable requests per second (default: 4)
 */

class RateLimiter {
    constructor(requestsPerSecond = null) {
      // Use env variable or default to 4
      this.requestsPerSecond = requestsPerSecond || 
        parseInt(process.env.BLOOIO_RATE_LIMIT_RPS) || 
        4;
      this.minTimeBetweenRequests = 1000 / this.requestsPerSecond;
      this.lastRequestTime = 0;
    }
  
    async waitForSlot() {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const timeToWait = Math.max(0, this.minTimeBetweenRequests - timeSinceLastRequest);
  
      if (timeToWait > 0) {
        await new Promise(resolve => setTimeout(resolve, timeToWait));
      }
  
      this.lastRequestTime = Date.now();
    }
  
    async execute(fn) {
      await this.waitForSlot();
      return await fn();
    }
  
    getStats() {
      return {
        requestsPerSecond: this.requestsPerSecond,
        minTimeBetweenRequests: this.minTimeBetweenRequests,
        lastRequestTime: this.lastRequestTime,
        timeSinceLastRequest: Date.now() - this.lastRequestTime,
      };
    }
  }
  
  // Create singleton instance
  const blooioRateLimiter = new RateLimiter();
  
  export default blooioRateLimiter;
  
  /**
   * Batch rate limiter - processes items in batches
   */
  export class BatchRateLimiter {
    constructor(requestsPerSecond = 4, batchSize = 10) {
      this.requestsPerSecond = requestsPerSecond;
      this.batchSize = batchSize;
      this.minTimeBetweenRequests = 1000 / requestsPerSecond;
      this.lastRequestTime = 0;
    }
  
    /**
     * Process an array of items with rate limiting
     * @param {Array} items - Items to process
     * @param {Function} processFn - Async function to process each item
     * @param {Function} onProgress - Progress callback (current, total)
     * @returns {Promise<Array>} - Results
     */
    async processAll(items, processFn, onProgress = null) {
      const results = [];
      
      for (let i = 0; i < items.length; i++) {
        // Wait for rate limit slot
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const timeToWait = Math.max(0, this.minTimeBetweenRequests - timeSinceLastRequest);
  
        if (timeToWait > 0) {
          await new Promise(resolve => setTimeout(resolve, timeToWait));
        }
  
        this.lastRequestTime = Date.now();
  
        // Process item
        try {
          const result = await processFn(items[i], i);
          results.push(result);
        } catch (error) {
          results.push({ error: error.message, item: items[i] });
        }
  
        // Call progress callback
        if (onProgress) {
          onProgress(i + 1, items.length);
        }
      }
  
      return results;
    }
  }