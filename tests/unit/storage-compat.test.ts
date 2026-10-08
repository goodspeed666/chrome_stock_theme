import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChromeStateAdapter, STATE_KEY } from '../../src/data/storage';
import { DEFAULT_STATE, type AppState, type Stock } from '../../src/domain/types';

describe('Chrome storage worker compatibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not send a history mutation to a legacy worker that ignores capability requests', async () => {
    const stock: Stock = {
      id: 'legacy-stock',
      groupId: 'group-tw',
      order: 0,
      market: 'TW',
      symbol: '2330',
      name: '台積電',
      gainDisplay: 'percent',
      alert: {},
      alertLatches: { above: false, below: false },
      quoteStatus: 'not-connected',
    };
    let persisted: AppState = { ...structuredClone(DEFAULT_STATE), stocks: [stock] };
    const set = vi.fn(async (value: Record<string, AppState>) => { persisted = value[STATE_KEY]!; });
    const sendMessage = vi.fn(async (message: { type: string; operation?: { type?: string } }) => {
      // A pre-history worker has no capability listener, so this request gets no response.
      if (message.type === 'STATE_CAPABILITIES') return undefined;
      if (message.type === 'STATE_MUTATE') {
        // Its unknown-operation switch returns undefined; the worker then normalizes and
        // persists DEFAULT_STATE, which is the data-loss behavior this guards against.
        if (message.operation?.type === 'prune-sales-history') {
          persisted = structuredClone(DEFAULT_STATE);
          await set({ [STATE_KEY]: persisted });
          return { state: persisted };
        }
      }
      return undefined;
    });
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension', sendMessage },
      storage: {
        local: { get: vi.fn(async () => ({ [STATE_KEY]: persisted })), set },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    } as unknown as typeof chrome);

    await expect(new ChromeStateAdapter().mutate({ type: 'prune-sales-history' }))
      .rejects.toThrow(/重新載入擴充功能/);

    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual(['STATE_CAPABILITIES']);
    expect(set).not.toHaveBeenCalled();
    expect(persisted.stocks.map((candidate) => candidate.id)).toEqual(['legacy-stock']);
  });
});
