import { MESSAGES_PACKAGE } from './notification-sources';
import { GOOGLE_WALLET_PACKAGE, parseWalletNotification } from './wallet-notification-parser';

describe('parseWalletNotification', () => {
  it('extracts only the confident fields from a Google Wallet purchase', () => {
    const candidate = parseWalletNotification({
      sourceApplication: GOOGLE_WALLET_PACKAGE,
      title: 'Google Wallet',
      text: 'Dimsum Break SMSEASIDE P1 · ₱103.00 · EastWest Visa Gold ••5008',
      notificationTimestamp: '2026-10-20T11:26:00.000Z',
      notificationKey: 'wallet-notification-key',
    });

    expect(candidate).toEqual(jasmine.objectContaining({
      sourceApplication: GOOGLE_WALLET_PACKAGE,
      merchantName: 'Dimsum Break SMSEASIDE P1',
      amount: 103,
      currency: 'PHP',
      cardLabel: 'EastWest Visa Gold',
      cardSuffix: '5008',
      notificationTimestamp: '2026-10-20T11:26:00.000Z',
      transactionTimestamp: null,
    }));
    expect(candidate?.id).toBe(`wallet-${candidate?.fingerprint}`);
  });

  it('captures outgoing transfer alerts relayed through the Messages app', () => {
    const candidate = parseWalletNotification({
      sourceApplication: MESSAGES_PACKAGE,
      title: 'My labs ❤️❤️❤️',
      text: 'You have successfully sent PHP20.00 to Dominique Betonio via Instapay. Reference No.: UB966676.',
      notificationTimestamp: '2026-10-20T11:26:00.000Z',
      notificationKey: 'messages-instapay-sent',
    });

    expect(candidate?.amount).toBe(20);
    expect(candidate?.transactionType).toBe('transfer');
    expect(candidate?.direction).toBe('outgoing');
  });

  it('ignores ordinary chat messages from the Messages app', () => {
    expect(parseWalletNotification({
      sourceApplication: MESSAGES_PACKAGE,
      title: 'Mom',
      text: 'Are you coming home for dinner tonight?',
      notificationTimestamp: '2026-10-20T11:26:00.000Z',
      notificationKey: 'messages-chat',
    })).toBeNull();
  });

  it('does not parse notifications from other applications', () => {
    expect(parseWalletNotification({
      sourceApplication: 'com.example.bank',
      title: 'Google Wallet',
      text: '₱103.00 at Dimsum Break',
      notificationTimestamp: '2026-10-20T11:26:00.000Z',
      notificationKey: 'other-app-key',
    })).toBeNull();
  });

  it('keeps ambiguous amount and merchant fields unavailable', () => {
    const candidate = parseWalletNotification({
      sourceApplication: GOOGLE_WALLET_PACKAGE,
      title: 'Google Wallet',
      text: 'Transaction approved',
      notificationTimestamp: '2026-10-20T11:26:00.000Z',
      notificationKey: 'incomplete-notification',
    });

    expect(candidate?.amount).toBeNull();
    expect(candidate?.currency).toBeNull();
    expect(candidate?.merchantName).toBeNull();
  });

  it('reads the amount from GCash bodies that omit the peso sign', () => {
    const candidate = parseWalletNotification({
      sourceApplication: 'com.globe.gcash.android',
      title: 'You have received money in GCash!',
      text: 'You have received 20.00 of GCash from Union Bank of the Philippines with account ending in 1422. Your new balance is 66.40 10-23-26 12:01 AM. Ref. No. 20261023UBPHPHMMXXXB999687679742929.',
      notificationTimestamp: '2026-10-22T16:01:39.000Z',
      notificationKey: 'gcash-notification-key',
    });

    expect(candidate?.amount).toBe(20);
    expect(candidate?.currency).toBe('PHP');
    expect(candidate?.merchantName).toBe('You have received money in GCash!');
  });
});
