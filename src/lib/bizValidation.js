// Returns an array of missing field labels required for invoice generation.
// Empty array = settings are complete enough to issue an invoice.
//
// Logic:
// - "Business name" required.
// - Bank details required: prefer the structured fields (accountName,
//   sortCode, accountNumber). If the legacy bankDetails free-text blob has
//   any content, treat it as a fallback and skip the structured-field check.
// - "VAT number" required only when biz.vatRegistered === true.

function isFilled(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function getMissingInvoiceFields(biz) {
  const missing = [];
  if (!biz || !isFilled(biz.name)) missing.push('Business name');

  const hasBankBlob = isFilled(biz?.bankDetails);
  if (!hasBankBlob) {
    if (!isFilled(biz?.accountName)) missing.push('Account name');
    if (!isFilled(biz?.sortCode)) missing.push('Sort code');
    if (!isFilled(biz?.accountNumber)) missing.push('Account number');
  }

  if (biz?.vatRegistered === true && !isFilled(biz?.vatNumber)) {
    missing.push('VAT number');
  }

  return missing;
}
