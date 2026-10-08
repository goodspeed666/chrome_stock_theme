import { describe, expect, it } from 'vitest';
import { APPEARANCE_THEMES, DEFAULT_STATE, normalizeAppearanceTheme, type AppState } from '../../src/domain/types';
import { createAccountSyncSnapshot, mergeAccountSyncSnapshot, parseAccountSyncSnapshot } from '../../src/data/accountSync';
import { LocalStateAdapter, normalizeState, STATE_KEY } from '../../src/data/storage';

describe('appearance theme preference', () => {
  it('recognizes all six approved theme IDs', () => {
    const expectedThemes = ['forest', 'midnight', 'sand', 'graphite', 'dusk', 'sky'];

    expect(APPEARANCE_THEMES).toEqual(expectedThemes);
    for (const theme of expectedThemes) expect(normalizeAppearanceTheme(theme)).toBe(theme);
  });

  it('defaults missing and unknown stored themes to forest', () => {
    const state = structuredClone(DEFAULT_STATE);
    const { appearanceTheme: _legacyTheme, ...legacySettings } = state.settings;
    const legacyState = { ...state, settings: legacySettings };

    expect(normalizeState(legacyState).settings.appearanceTheme).toBe('forest');
    expect(normalizeState({ ...state, settings: { ...state.settings, appearanceTheme: 'unknown' } }).settings.appearanceTheme).toBe('forest');
  });

  it('persists a changed theme through the existing local settings adapter', async () => {
    localStorage.clear();
    const adapter = new LocalStateAdapter();

    for (const theme of ['midnight', 'sand', 'graphite', 'dusk', 'sky']) {
      await adapter.mutate({ type: 'update-settings', settings: { appearanceTheme: theme as AppState['settings']['appearanceTheme'] } });
      expect((JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as AppState).settings.appearanceTheme).toBe(theme);
      expect((await adapter.load()).settings.appearanceTheme).toBe(theme);
    }

    localStorage.clear();
  });

  it('syncs all six themes, accepts snapshots from before themes existed, and rejects unknown values', () => {
    for (const theme of ['forest', 'midnight', 'sand', 'graphite', 'dusk', 'sky']) {
      const state = structuredClone(DEFAULT_STATE);
      state.settings.appearanceTheme = theme as typeof state.settings.appearanceTheme;
      const snapshot = createAccountSyncSnapshot(state, { deviceId: 'device-a', revision: 1, updatedAt: 10 });

      expect(snapshot.settings.appearanceTheme).toBe(theme);
      expect(parseAccountSyncSnapshot(snapshot)?.settings.appearanceTheme).toBe(theme);
      expect(mergeAccountSyncSnapshot(DEFAULT_STATE, snapshot).settings.appearanceTheme).toBe(theme);

      if (theme === 'forest') {
        const legacySnapshot = structuredClone(snapshot);
        const { appearanceTheme: _theme, ...legacySettings } = legacySnapshot.settings;
        legacySnapshot.settings = legacySettings as typeof snapshot.settings;
        expect(parseAccountSyncSnapshot(legacySnapshot)?.settings.appearanceTheme).toBe('forest');
      }
      expect(parseAccountSyncSnapshot({ ...snapshot, settings: { ...snapshot.settings, appearanceTheme: 'ultraviolet' } })).toBeNull();
    }
  });
});
