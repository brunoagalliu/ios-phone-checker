import { put, del, list, head } from '@vercel/blob';

/**
 * Upload a file to Vercel Blob Storage
 * @param {File|Buffer} file - File to upload
 * @param {string} filename - Name for the file
 * @param {string} folder - Optional folder path
 * @returns {Promise<object>} - { url, pathname, downloadUrl }
 */
export async function uploadFile(file, filename, folder = 'uploads') {
  try {
    const pathname = `${folder}/${Date.now()}_${filename}`;
    
    const blob = await put(pathname, file, {
      access: 'public',
      addRandomSuffix: false,
    });
    
    console.log(`File uploaded: ${blob.url}`);
    
    return {
      url: blob.url,
      pathname: blob.pathname,
      downloadUrl: blob.downloadUrl,
      size: blob.size,
      uploadedAt: blob.uploadedAt,
    };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

/**
 * Upload CSV results to Vercel Blob Storage
 * @param {string} csvContent - CSV content as string
 * @param {string} filename - Name for the file
 * @returns {Promise<object>} - Blob details
 */
export async function uploadCSVResults(csvContent, filename) {
  try {
    const pathname = `results/${Date.now()}_${filename}`;
    
    const blob = await put(pathname, csvContent, {
      access: 'public',
      addRandomSuffix: false,
      contentType: 'text/csv',
    });
    
    console.log(`CSV uploaded: ${blob.url}`);
    
    return {
      url: blob.url,
      pathname: blob.pathname,
      downloadUrl: blob.downloadUrl,
      size: blob.size,
      uploadedAt: blob.uploadedAt,
    };
  } catch (error) {
    console.error('Error uploading CSV:', error);
    throw error;
  }
}

/**
 * Delete a file from Vercel Blob Storage
 * @param {string} url - File URL to delete
 */
export async function deleteFile(url) {
  try {
    await del(url);
    console.log(`File deleted: ${url}`);
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

/**
 * List all files in a folder
 * @param {string} prefix - Folder prefix
 * @returns {Promise<Array>} - List of files
 */
export async function listFiles(prefix = '') {
  try {
    const { blobs } = await list({ prefix });
    return blobs;
  } catch (error) {
    console.error('Error listing files:', error);
    throw error;
  }
}

/**
 * Get file metadata
 * @param {string} url - File URL
 * @returns {Promise<object>} - File metadata
 */
export async function getFileMetadata(url) {
  try {
    const metadata = await head(url);
    return metadata;
  } catch (error) {
    console.error('Error getting file metadata:', error);
    throw error;
  }
}

/**
 * Generate CSV from results and upload
 * @param {Array} results - Results array
 * @param {string} filename - Base filename
 * @returns {Promise<object>} - Blob details
 */
export async function uploadResultsAsCSV(results, filename) {
  const Papa = require('papaparse');
  
  const csv = Papa.unparse(results.map(r => ({
    original_number: r.original_number || r.phone_number,
    formatted_number: r.formatted_number || r.phone_number,
    display_number: r.display_number || r.phone_number,
    is_ios: r.is_ios ? 'YES' : 'NO',
    supports_imessage: r.supports_imessage ? 'YES' : 'NO',
    supports_sms: r.supports_sms ? 'YES' : 'NO',
    from_cache: r.from_cache ? 'YES' : 'NO',
    cache_age_days: r.cache_age_days || 'N/A',
    error: r.error || 'None',
    checked_at: new Date().toISOString()
  })));
  
  return await uploadCSVResults(csv, filename);
}