export const GOOGLE_WALLET_PACKAGE = 'com.google.android.apps.walletnfcrel';

/**
 * Notification sources the app monitors. Package IDs for banks and e-wallets must be
 * verified on a physical device before release; a wrong ID just means that app is ignored.
 */
export const MONITORED_SOURCES: Readonly<Record<string, string>> = {
  [GOOGLE_WALLET_PACKAGE]: 'Google Wallet',
  'com.globe.gcash.android': 'GCash',
  'ph.com.gotyme.android': 'GoTyme',
  'com.unionbankph.online': 'UnionBank',
  'com.rcbc.rcbcpulz': 'RCBC',
  'com.rcbc.mobilebanking': 'RCBC',
  'com.eastwestbanking.easyway': 'EastWest',
  'com.metrobank.mobbanking': 'Metrobank',
};

export type NotificationTransactionType =
  | 'payment'
  | 'transfer'
  | 'refund'
  | 'fee'
  | 'unknown';

export type NotificationDirection = 'outgoing' | 'incoming' | 'unknown';

export interface NotificationClassification {
  transactionType: NotificationTransactionType;
  direction: NotificationDirection;
}

/** Returns the display label for a monitored package, or null when it is not monitored. */
export function monitoredSourceLabel(packageName: string): string | null {
  return Object.prototype.hasOwnProperty.call(MONITORED_SOURCES, packageName)
    ? MONITORED_SOURCES[packageName]
    : null;
}

/**
 * Classifies a notification from its text. Ambiguous text returns 'unknown' so the
 * user must classify it before it is saved.
 */
export function classifyNotification(content: string): NotificationClassification {
  const text = content.toLowerCase();

  let transactionType: NotificationTransactionType = 'unknown';
  if (/\b(refund|reversed|reversal)\b/.test(text)) transactionType = 'refund';
  else if (/\b(service fee|fee|charge|convenience fee)\b/.test(text)) transactionType = 'fee';
  else if (/\b(instapay|pesonet|transfer|sent money|money sent|received money|you received)\b/.test(text)) {
    transactionType = 'transfer';
  } else if (/\b(paid|payment|spent|purchase|you paid)\b/.test(text)) {
    transactionType = 'payment';
  }

  let direction: NotificationDirection = 'unknown';
  if (/\b(received|incoming|credited|you got)\b/.test(text)) direction = 'incoming';
  else if (/\b(sent|paid|spent|debited|outgoing|purchase)\b/.test(text)) direction = 'outgoing';

  if (transactionType === 'refund') direction = 'incoming';
  return { transactionType, direction };
}

/**
 * Extracts a reference number when present. Only the reference is kept; the raw
 * notification body is never stored.
 */
export function extractReferenceNumber(content: string): string | null {
  const match = content.match(/\b(?:ref(?:erence)?|trace|txn)\.?\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})\b/i);
  if (!match || !/\d/.test(match[1])) return null;
  return match[1].toUpperCase();
}
