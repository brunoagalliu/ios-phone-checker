/**
 * US Phone Number Validator and Formatter
 * Validates and formats US phone numbers with proper area code checking
 */

// Valid US area codes (200-999, excluding N11 codes)
const VALID_AREA_CODES = new Set();

// Generate valid area codes
for (let i = 200; i <= 999; i++) {
  const code = i.toString();
  // Exclude N11 codes (211, 311, 411, 511, 611, 711, 811, 911)
  if (!code.endsWith('11')) {
    VALID_AREA_CODES.add(code);
  }
}

/**
 * Extract digits from phone number
 */
function extractDigits(phone) {
  return phone.toString().replace(/\D/g, '');
}

/**
 * Validate US area code
 */
function isValidAreaCode(areaCode) {
  if (!areaCode || areaCode.length !== 3) return false;
  
  // Area code cannot start with 0 or 1
  if (areaCode[0] === '0' || areaCode[0] === '1') return false;
  
  // Check against valid area codes set
  return VALID_AREA_CODES.has(areaCode);
}

/**
 * Validate exchange code (NXX format)
 * N = 2-9, X = 0-9
 */
function isValidExchangeCode(exchange) {
  if (!exchange || exchange.length !== 3) return false;
  
  // First digit must be 2-9
  const firstDigit = parseInt(exchange[0]);
  if (firstDigit < 2 || firstDigit > 9) return false;
  
  // Cannot be N11
  if (exchange.endsWith('11') && firstDigit >= 2 && firstDigit <= 9) return false;
  
  return true;
}

/**
 * Format and validate US phone number
 * @param {string} phone - Input phone number in any format
 * @returns {object} - { valid: boolean, formatted: string, error: string }
 */
export function formatUSPhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return { valid: false, formatted: null, error: 'Invalid input' };
  }
  
  // Extract only digits
  let digits = extractDigits(phone);
  
  // Handle empty or too short
  if (!digits || digits.length < 10) {
    return { valid: false, formatted: null, error: 'Less than 10 digits' };
  }
  
  // Remove leading 1 if present (we'll add it back)
  if (digits.length === 11 && digits[0] === '1') {
    digits = digits.substring(1);
  }
  
  // Must be exactly 10 digits for US
  if (digits.length !== 10) {
    return { valid: false, formatted: null, error: 'Not 10 digits' };
  }
  
  // Extract components
  const areaCode = digits.substring(0, 3);
  const exchangeCode = digits.substring(3, 6);
  const subscriberNumber = digits.substring(6, 10);
  
  // Validate area code
  if (!isValidAreaCode(areaCode)) {
    return { 
      valid: false, 
      formatted: null, 
      error: `Invalid area code: ${areaCode}` 
    };
  }
  
  // Validate exchange code
  if (!isValidExchangeCode(exchangeCode)) {
    return { 
      valid: false, 
      formatted: null, 
      error: `Invalid exchange code: ${exchangeCode}` 
    };
  }
  
  // Format as 1 + 10 digits
  const formatted = `1${areaCode}${exchangeCode}${subscriberNumber}`;
  
  return { 
    valid: true, 
    formatted: formatted,
    e164: `+${formatted}`,
    display: `+1 (${areaCode}) ${exchangeCode}-${subscriberNumber}`,
    error: null 
  };
}

/**
 * Process array of phone numbers - validate, format, remove duplicates
 * @param {Array} phones - Array of phone numbers
 * @returns {object} - { valid: Array, invalid: Array, stats: object }
 */
export function processPhoneArray(phones) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  const stats = {
    total: phones.length,
    valid: 0,
    invalid: 0,
    duplicates: 0,
    blank: 0
  };
  
  phones.forEach((phone, index) => {
    // Skip blank/empty
    if (!phone || phone.toString().trim() === '') {
      stats.blank++;
      invalid.push({
        original: phone,
        error: 'Blank or empty',
        line: index + 1
      });
      return;
    }
    
    const result = formatUSPhone(phone);
    
    if (result.valid) {
      // Check for duplicates
      if (seen.has(result.formatted)) {
        stats.duplicates++;
        invalid.push({
          original: phone,
          formatted: result.formatted,
          error: 'Duplicate',
          line: index + 1
        });
      } else {
        seen.add(result.formatted);
        stats.valid++;
        valid.push({
          original: phone,
          formatted: result.formatted,
          e164: result.e164,
          display: result.display,
          line: index + 1
        });
      }
    } else {
      stats.invalid++;
      invalid.push({
        original: phone,
        error: result.error,
        line: index + 1
      });
    }
  });
  
  return { valid, invalid, stats };
}

/**
 * Test if a string looks like a phone number
 */
export function looksLikePhone(str) {
  if (!str) return false;
  const digits = extractDigits(str);
  return digits.length >= 10 && digits.length <= 11;
}