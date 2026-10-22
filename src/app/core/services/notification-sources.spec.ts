import {
  classifyNotification,
  extractReferenceNumber,
  monitoredSourceLabel,
} from './notification-sources';
import { parseWalletNotification } from './wallet-notification-parser';

describe('notification sources', () => {
  it('monitors registered packages and rejects others', () => {
    expect(monitoredSourceLabel('com.globe.gcash.android')).toBe('GCash');
    expect(monitoredSourceLabel('com.example.random')).toBeNull();
  });

  it('classifies an outgoing payment', () => {
    expect(classifyNotification('You paid ₱250.00 to Foodpanda')).toEqual({
      transactionType: 'payment',
      direction: 'outgoing',
    });
  });

  it('classifies an incoming transfer', () => {
    expect(classifyNotification('You received ₱1,000 from Juan via InstaPay')).toEqual({
      transactionType: 'transfer',
      direction: 'incoming',
    });
  });

  it('classifies a refund as incoming', () => {
    expect(classifyNotification('Refund of ₱300 has been reversed to your account')).toEqual({
      transactionType: 'refund',
      direction: 'incoming',
    });
  });

  it('returns unknown for ambiguous text so the user must classify it', () => {
    expect(classifyNotification('Balance update ₱500')).toEqual({
      transactionType: 'unknown',
      direction: 'unknown',
    });
  });

  it('extracts a reference number and uppercases it', () => {
    expect(extractReferenceNumber('Ref No. ab12cd34ef')).toBe('AB12CD34EF');
    expect(extractReferenceNumber('No reference here')).toBeNull();
  });

  it('parses a GCash notification into a classified candidate', () => {
    const parsed = parseWalletNotification({
      sourceApplication: 'com.globe.gcash.android',
      title: 'GCash',
      text: 'You paid ₱250.00 to Foodpanda. Ref No. GC998877',
      notificationTimestamp: '2025-01-01T00:00:00.000Z',
      notificationKey: 'key-1',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.amount).toBe(250);
    expect(parsed?.transactionType).toBe('payment');
    expect(parsed?.direction).toBe('outgoing');
    expect(parsed?.referenceNumber).toBe('GC998877');
  });

  it('ignores notifications from unmonitored packages', () => {
    expect(
      parseWalletNotification({
        sourceApplication: 'com.example.random',
        title: 'Paid',
        text: '₱10',
        notificationTimestamp: '2025-01-01T00:00:00.000Z',
        notificationKey: 'key-2',
      })
    ).toBeNull();
  });
});
