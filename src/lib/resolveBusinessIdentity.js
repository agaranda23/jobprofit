/**
 * resolveBusinessIdentity — single source of truth for business details on documents.
 *
 * Merges the legacy localStorage `biz` object and the Supabase `profiles` row into
 * one canonical object that every PDF generator and message builder can consume.
 *
 * Priority: profile wins for every field it has set (because Settings writes to
 * profile, and profile is always fresher than the stale localStorage biz object).
 * The only exception is logoUrl/logo_url where we keep both camelCase and
 * snake_case shapes so the generators can read either.
 *
 * Field mapping (Settings column → generator field):
 *   profiles.business_name  → name
 *   profiles.address        → address
 *   profiles.phone          → phone
 *   profiles.email          → email
 *   profiles.website        → website
 *   profiles.logo_url       → logoUrl, logo_url
 *   profiles.account_name   → accountName
 *   profiles.sort_code      → sortCode
 *   profiles.account_number → accountNumber
 *   profiles.vat_number     → vatNumber
 *   profiles.vat_registered → vatRegistered
 *   profiles.utr_number     → utr
 *   profiles.stripe_payment_link → stripePaymentLink
 *   profiles.terms_text     → termsText
 *
 * All generators (generateInvoicePDF, generateQuotePDF, generateReceiptPDF) already
 * have their own internal effectiveBiz merge — this function is the call-site
 * equivalent so callers don't have to duplicate the mapping logic. When a generator
 * also receives the raw profile, its internal merge just confirms the same result.
 */

export function resolveBusinessIdentity(biz, profile) {
  return {
    // Identity
    name:           profile?.business_name  || biz?.name           || '',
    address:        profile?.address        || biz?.address         || '',
    phone:          profile?.phone          || biz?.phone           || '',
    email:          profile?.email          || biz?.email           || '',
    website:        profile?.website        || biz?.website         || '',

    // Logo — keep both field shapes so generators can read either
    logoUrl:        profile?.logo_url       || biz?.logoUrl         || biz?.logo_url || '',
    logo_url:       profile?.logo_url       || biz?.logo_url        || biz?.logoUrl  || '',

    // Bank details
    accountName:    profile?.account_name   || biz?.accountName     || '',
    sortCode:       profile?.sort_code      || biz?.sortCode        || biz?.sort_code || '',
    accountNumber:  profile?.account_number || biz?.accountNumber   || biz?.account_number || '',
    bankDetails:    biz?.bankDetails        || '',

    // Tax IDs
    vatNumber:      profile?.vat_number     || biz?.vatNumber       || biz?.vat_number || '',
    vatRegistered:  profile?.vat_registered ?? biz?.vatRegistered   ?? biz?.vat_registered ?? false,
    utr:            profile?.utr_number     || biz?.utr             || biz?.utr_number || '',

    // Payments
    stripePaymentLink: profile?.stripe_payment_link
                       || biz?.stripePaymentLink
                       || biz?.stripe_payment_link
                       || '',

    // Document content
    termsText:      profile?.terms_text     || biz?.termsText       || biz?.terms_text || '',
  };
}
