import {
  classifyNotification,
  extractReferenceNumber,
  GOOGLE_WALLET_PACKAGE,
  monitoredSourceLabel,
  NotificationDirection,
  NotificationTransactionType,
} from './notification-sources';

/** Verb-led amount with a required decimal part, e.g. "received 20.00" or "sent 1,250.50". */
const VERB_AMOUNT_PATTERN = /\b(?:received|sent|paid|spent|debited|credited|transferred)\s+([0-9][0-9,]*\.[0-9]{2})\b/i;

export { GOOGLE_WALLET_PACKAGE };

export interface WalletNotificationInput {
  sourceApplication: string;
  title: string | null;
  text: string | null;
  notificationTimestamp: string;
  notificationKey: string;
}

export interface ParsedWalletNotification {
  id: string;
  sourceApplication: string;
  merchantName: string | null;
  amount: number | null;
  currency: string | null;
  cardLabel: string | null;
  cardSuffix: string | null;
  notificationTimestamp: string;
  transactionTimestamp: string | null;
  fingerprint: string;
  transactionType: NotificationTransactionType;
  direction: NotificationDirection;
  referenceNumber: string | null;
}

const GENERIC_TITLES = /^(google wallet|wallet|payment|purchase|transaction|notification)$/i;

export function parseWalletNotification(
  input: WalletNotificationInput
): ParsedWalletNotification | null {
  if (monitoredSourceLabel(input.sourceApplication) === null) return null;

  const title = input.title?.trim() ?? '';
  const text = input.text?.trim() ?? '';
  const content = [title, text].filter(Boolean).join('\n');
  const classification = classifyNotification(content);
  const referenceNumber = extractReferenceNumber(content);
  const amountMatch = content.match(/(?:₱|PHP\s*)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  // GCash-style bodies omit the peso sign ("You have received 20.00 of GCash"), so fall back to a verb-led amount.
  const verbAmountMatch = amountMatch ? null : content.match(VERB_AMOUNT_PATTERN);
  const parsedAmount = amountMatch
    ? Number(amountMatch[1].replaceAll(',', ''))
    : verbAmountMatch
      ? Number(verbAmountMatch[1].replaceAll(',', ''))
      : NaN;
  const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  const currency = amount === null ? null : 'PHP';

  const merchantMatch = content.match(
    /\b(?:at|to)\s+([^\n,;]+?)(?=\s+(?:for|using|with|on)\b|\s*(?:₱|PHP\b)|\s*[·|]\s*(?=(?:₱|PHP\b|EastWest|BDO|BPI|Metrobank|UnionBank|Security Bank|Citibank|HSBC|Maybank|Visa|Mastercard|Amex|Card\b))|$)/i
  );
  let merchantName = merchantMatch?.[1]?.trim() ?? null;
  if (!merchantName && amountMatch) {
    const beforeAmount = content.slice(0, amountMatch.index).split('\n').pop()?.trim() ?? '';
    merchantName = beforeAmount.replace(/^(?:you\s+(?:spent|paid)|purchase(?:\s+at)?)\s+/i, '').trim();
  }
  if (!merchantName && title && !GENERIC_TITLES.test(title) && !/₱|PHP/i.test(title)) {
    merchantName = title;
  }
  if (merchantName && amountMatch) {
    merchantName = merchantName.replace(amountMatch[0], '').trim();
  }
  if (merchantName) {
    merchantName = merchantName
      .replace(/\s+(?:visa|mastercard|master\s*card|amex|american express|card)\b.*$/i, '')
      .replace(/[·|]+$/g, '')
      .trim();
  }
  if (merchantName && GENERIC_TITLES.test(merchantName)) merchantName = null;

  const cardMatch = content.match(
    /\b((?:(?:EastWest|BDO|BPI|Metrobank|UnionBank|Security Bank|Citibank|HSBC|Maybank)\s+)?(?:Visa|Mastercard|Master\s*Card|Amex|American Express|Card)(?:\s+[A-Za-z]+){0,2})\s*(?:[•*xX]{2,}\s*)(\d{4})\b/i
  );
  const cardSuffix = cardMatch?.[2] ?? null;
  const cardLabel = cardMatch?.[1]?.trim() ?? null;

  const fingerprint = stableFingerprint(input.notificationKey || [
    input.sourceApplication,
    input.notificationTimestamp,
    title,
    text,
  ].join('|'));

  return {
    id: `wallet-${fingerprint}`,
    sourceApplication: input.sourceApplication,
    merchantName: merchantName || null,
    amount,
    currency,
    cardLabel,
    cardSuffix,
    notificationTimestamp: input.notificationTimestamp,
    transactionTimestamp: null,
    fingerprint,
    transactionType: classification.transactionType,
    direction: classification.direction,
    referenceNumber,
  };
}

function stableFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
