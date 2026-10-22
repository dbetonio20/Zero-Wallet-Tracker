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
});
