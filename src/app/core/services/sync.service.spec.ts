import { getChangedSyncedRecords, waitForPendingWritesWithTimeout } from './sync.service';

describe('getChangedSyncedRecords', () => {
  it('returns only changed and added records', () => {
    const existing = { id: 'existing', name: 'Old', details: { amount: 10 } };
    const unchanged = { id: 'unchanged', name: 'Same', details: { amount: 5 } };
    const changed = { ...existing, name: 'New' };
    const added = { id: 'added', name: 'New record', details: { amount: 1 } };

    expect(getChangedSyncedRecords([unchanged, changed, added], [existing, unchanged])).toEqual([
      changed,
      added,
    ]);
  });

  it('returns no records for deeply equal lists or removed-only records', () => {
    const previous = { id: 'same', details: { amount: 10 } };

    expect(getChangedSyncedRecords([{ id: 'same', details: { amount: 10 } }], [previous])).toEqual(
      []
    );
    expect(getChangedSyncedRecords([], [previous])).toEqual([]);
  });
});

describe('waitForPendingWritesWithTimeout', () => {
  it('resolves after pending writes are acknowledged', async () => {
    const waitForWrites = jasmine.createSpy().and.resolveTo(undefined);

    await expectAsync(waitForPendingWritesWithTimeout(waitForWrites, 100)).toBeResolved();
    expect(waitForWrites).toHaveBeenCalledTimes(1);
  });

  it('rejects when pending writes exceed the timeout', async () => {
    const waitForWrites = () => new Promise<void>(() => undefined);

    await expectAsync(waitForPendingWritesWithTimeout(waitForWrites, 1)).toBeRejectedWithError(
      'Sync timed out. Check your connection and try again.'
    );
  });
});
