import { TestBed } from '@angular/core/testing';
import { PreferencesService } from '../../core/services/preferences.service';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let done: boolean;
  let fail: boolean;
  let service: OnboardingService;

  beforeEach(() => {
    done = false;
    fail = false;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PreferencesService,
          useValue: {
            isOnboardingDone: async () => {
              if (fail) throw new Error('storage');
              return done;
            },
            setOnboardingDone: async (value: boolean) => {
              if (fail) throw new Error('storage');
              done = value;
            },
          },
        },
      ],
    });
    service = TestBed.inject(OnboardingService);
  });

  it('shows for first-time users only', async () => {
    await service.showIfFirstTime();
    expect(service.visible()).toBe(true);
    await service.finish();
    expect(service.visible()).toBe(false);
    expect(done).toBe(true);
    await service.showIfFirstTime();
    expect(service.visible()).toBe(false);
  });

  it('replay keeps the completed flag', async () => {
    done = true;
    service.open();
    expect(service.visible()).toBe(true);
    expect(done).toBe(true);
  });

  it('handles storage errors safely', async () => {
    fail = true;
    await service.showIfFirstTime();
    expect(service.visible()).toBe(false);
    service.open();
    await service.finish();
    expect(service.visible()).toBe(false);
  });
});
