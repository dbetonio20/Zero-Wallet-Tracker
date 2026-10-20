export const GOOGLE_WALLET_PACKAGE = 'com.google.android.apps.walletnfcrel';

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
}

const GENERIC_TITLES = /^(google wallet|wallet|payment|purchase|transaction|notification)$/i;

export function parseWalletNotification(
  input: WalletNotificationInput
): ParsedWalletNotification | null {
  if (input.sourceApplication !== GOOGLE_WALLET_PACKAGE) return null;

  const title = input.title?.trim() ?? '';
  const text = input.text?.trim() ?? '';
  const content = [title, text].filter(Boolean).join('\n');
  const amountMatch = content.match(/(?:₱|PHP\s*)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const parsedAmount = amountMatch ? Number(amountMatch[1].replaceAll(',', '')) : NaN;
  const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : null;
  const currency = amount === null ? null : /₱|PHP/i.test(amountMatch?.[0] ?? '') ? 'PHP' : null;

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
