// Returns an array of missing field labels required for invoice generation.
// Empty array = settings are complete enough to issue an invoice.
//
// Logic:
// - "Business name" required.
// - Bank details required: prefer the structured fields (accountName,
//   sortCode, accountNumber). If the legacy bankDetails free-text blob has
//   any content, treat it as a fallback and skip the structured-field check.
// - "VAT number" required only when biz.vatRegistered === true.
//
// Two data sources: legacy localStorage `biz` (camelCase) and Supabase
// `profiles` row (snake_case). When `profile` is supplied, its fields take
// priority; biz fields are the fallback. This bridges the gap for new-nav
// users who complete the onboarding wizard (writes to profiles only) before
// the Send Invoice CTA is wired to new-nav screens.

function isFilled(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// Prefer the profile value; fall back to the biz value.
function prefer(profileVal, bizVal) {
  return isFilled(profileVal) ? profileVal : bizVal;
}

export function getMissingInvoiceFields(biz, profile) {
  const missing = [];

  // Business name: profiles.business_name → biz.name
  const businessName = prefer(profile?.business_name, biz?.name);
  if (!isFilled(businessName)) missing.push('Business name');

  // Bank blob fallback (legacy free-text) — biz only, no profile equivalent
  const hasBankBlob = isFilled(biz?.bankDetails);
  if (!hasBankBlob) {
    // Account name: profiles stores first+last, biz stores accountName.
    // For new-nav users the wizard writes first_name/last_name but not a
    // combined accountName, so we treat either source as sufficient.
    const accountName = prefer(
      profile?.first_name && profile?.last_name
        ? `${profile.first_name} ${profile.last_name}`
        : profile?.first_name || profile?.last_name,
      biz?.accountName
    );
    if (!isFilled(accountName)) missing.push('Account name');

    // Sort code: profiles.sort_code → biz.sortCode
    const sortCode = prefer(profile?.sort_code, biz?.sortCode);
    if (!isFilled(sortCode)) missing.push('Sort code');

    // Account number: profiles.account_number → biz.accountNumber
    const accountNumber = prefer(profile?.account_number, biz?.accountNumber);
    if (!isFilled(accountNumber)) missing.push('Account number');
  }

  if (biz?.vatRegistered === true && !isFilled(biz?.vatNumber)) {
    missing.push('VAT number');
  }

  return missing;
}
