import { useCallback, useEffect, useMemo, useState } from 'react';
import { createStateAdapter, type StateOperation } from './data/storage';
import { loadBackgroundCatalog, type BackgroundImage } from './data/backgrounds';
import { readUploadedBackground, subscribeToBackgroundUpdates } from './data/images';
import { DEFAULT_STATE, type AppState, type Market, type Stock, type StockGroup } from './domain/types';
import { formatTaipeiCalendarDate, getTaipeiGreeting } from './domain/calendar';
import { shouldHideWelcome } from './domain/marketHours';
import { resetAlertLatches } from './domain/alerts';
import { Dialog } from './components/Dialog';
import { Icon } from './components/Icons';
import { SettingsDrawer } from './components/SettingsDrawer';
import { StockCard } from './components/StockCard';
import { StockFormDialog, type StockDraft } from './components/StockFormDialog';

const adapter = createStateAdapter();
const APP_VERSION = __APP_VERSION__;
const BUILD_TIMESTAMP = __BUILD_TIMESTAMP__;

function formatTaipeiBuildTime(timestamp: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const getPart = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${getPart('year')}/${getPart('month')}/${getPart('day')} ${getPart('hour')}:${getPart('minute')}`;
}

const BUILD_UPDATED_AT = formatTaipeiBuildTime(BUILD_TIMESTAMP);
const BUILD_META_LABEL = `版本 ${APP_VERSION}，更新於 ${BUILD_UPDATED_AT}（台北時間）`;
const BUILD_META_SHORT_TIME = BUILD_UPDATED_AT.slice(5);

function browserExtensionAvailable() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

async function lookupStockName(market: Market, symbol: string): Promise<string | null> {
  const result = await chrome.runtime.sendMessage({ type: 'LOOKUP_SYMBOL_NAME', market, symbol });
  if (result?.error) throw new Error(String(result.error));
  return typeof result?.name === 'string' ? result.name : null;
}

function displayStatus(state: AppState): { label: string; tone: string } {
  const stocks = state.stocks;
  if (!stocks.length) return { label: '尚未連接行情', tone: 'quiet' };
  const live = stocks.some((stock) => stock.quote && stock.quoteStatus === 'live');
  if (live) return { label: '行情已更新', tone: 'connected' };
  const keys = Boolean(state.settings.fugleKey || state.settings.finnhubKey);
  const error = stocks.some((stock) => stock.quoteError && stock.quoteError !== 'not-connected' && stock.quoteError !== 'no-trade');
  if (error) return { label: '部分行情需要處理', tone: 'warning' };
  if (!keys) return { label: '尚未連接行情', tone: 'quiet' };
  return { label: '等待新成交', tone: 'pending' };
}

interface GroupFormProps {
  group?: StockGroup;
  onClose: () => void;
  onSave: (name: string) => void;
}

function GroupForm({ group, onClose, onSave }: GroupFormProps) {
  const [name, setName] = useState(group?.name ?? '');
  const [error, setError] = useState('');
  return <Dialog title={group ? '重新命名分區' : '新增分區'} onClose={onClose} className="small-dialog">
    <form className="stack-form" onSubmit={(event) => { event.preventDefault(); const value = name.trim(); if (!value) { setError('請輸入分區名稱'); return; } onSave(value); }}>
      <label>分區名稱<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={24} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" type="submit">儲存</button></footer>
    </form>
  </Dialog>;
}

interface DeleteGroupDialogProps {
  group: StockGroup;
  count: number;
  groups: StockGroup[];
  onClose: () => void;
  onConfirm: (moveToGroupId?: string, deleteStocks?: boolean) => void;
}

function DeleteGroupDialog({ group, count, groups, onClose, onConfirm }: DeleteGroupDialogProps) {
  const [choice, setChoice] = useState<'move' | 'delete'>('move');
  const [target, setTarget] = useState(groups[0]?.id ?? '');
  return <Dialog title="刪除分區" description={count ? `「${group.name}」有 ${count} 張股票卡片，請選擇如何處理。` : `確定刪除「${group.name}」分區嗎？`} onClose={onClose} className="small-dialog">
    {count > 0 ? <div className="delete-group-options">
      <label className={`choice-card ${choice === 'move' ? 'selected' : ''}`}><input type="radio" name="delete-mode" value="move" checked={choice === 'move'} onChange={() => setChoice('move')} /><span><b>移至其他分區</b><small>保留股票與提醒設定</small></span></label>
      {choice === 'move' && <label className="target-group">移至<select value={target} onChange={(event) => setTarget(event.target.value)}>{groups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className={`choice-card destructive-choice ${choice === 'delete' ? 'selected' : ''}`}><input type="radio" name="delete-mode" value="delete" checked={choice === 'delete'} onChange={() => setChoice('delete')} /><span><b>一併移除 {count} 張股票</b><small>股票卡片、持股資料與提醒設定會一併刪除</small></span></label>
      <p className="form-error subdued-error">這項操作會立即影響 {count} 張卡片。請確認選擇後再繼續。</p>
    </div> : <p className="form-note">刪除後無法復原。</p>}
    <footer className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="danger-button" onClick={() => onConfirm(choice === 'move' ? target : undefined, choice === 'delete')}>確認刪除分區</button></footer>
  </Dialog>;
}

export default function App() {
  const [state, setState] = useState<AppState>(structuredClone(DEFAULT_STATE));
  const [dateNow, setDateNow] = useState(() => new Date());
  const [catalog, setCatalog] = useState<BackgroundImage[]>([]);
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState<string | null>(null);
  const [customBackgroundRevision, setCustomBackgroundRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stockDialog, setStockDialog] = useState<{ stock?: Stock; groupId?: string } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ group?: StockGroup } | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<StockGroup | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const displayedDate = formatTaipeiCalendarDate(dateNow);

  const persist = useCallback(async (operation: StateOperation) => {
    try {
      const next = await adapter.mutate(operation);
      setState(next);
      return next;
    } catch (error) {
      setToast(error instanceof Error ? error.message : '儲存失敗，請重試');
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void Promise.all([adapter.load(), loadBackgroundCatalog().catch(() => [])]).then(([initial, backgrounds]) => {
      if (!mounted) return;
      setState(initial);
      setCatalog(backgrounds);
      setLoading(false);
    });
    const unsubscribe = adapter.subscribe((next) => { if (mounted) setState(next); });
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    const updateDate = () => setDateNow(new Date());
    const updateWhenVisible = () => { if (document.visibilityState === 'visible') updateDate(); };
    const interval = window.setInterval(updateDate, 60_000);
    window.addEventListener('focus', updateDate);
    document.addEventListener('visibilitychange', updateWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', updateDate);
      document.removeEventListener('visibilitychange', updateWhenVisible);
    };
  }, []);

  useEffect(() => subscribeToBackgroundUpdates(() => setCustomBackgroundRevision((revision) => revision + 1)), []);

  useEffect(() => {
    if (state.background.selectedId !== 'custom') {
      setCustomBackgroundUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return null; });
      return;
    }
    let active = true;
    let newUrl: string | null = null;
    void readUploadedBackground().then((blob) => {
      if (!active || !blob) return;
      newUrl = URL.createObjectURL(blob);
      setCustomBackgroundUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return newUrl; });
    }).catch(() => undefined);
    return () => { active = false; if (newUrl) URL.revokeObjectURL(newUrl); };
  }, [state.background.selectedId, customBackgroundRevision]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const sortedGroups = useMemo(() => [...state.groups].sort((a, b) => a.order - b.order), [state.groups]);
  const activeBackground = catalog.find((item) => item.id === state.background.selectedId);
  const backgroundUrl = state.background.selectedId === 'custom' ? customBackgroundUrl : activeBackground ? `/${activeBackground.asset}` : null;
  const status = displayStatus(state);
  const welcomeHidden = loading || shouldHideWelcome([...new Set(state.stocks.map((stock) => stock.market))], state.settings.welcomeManuallyHidden, dateNow);

  async function addStock(draft: StockDraft) {
    const order = state.stocks.filter((stock) => stock.groupId === draft.groupId).reduce((max, stock) => Math.max(max, stock.order), -1) + 1;
    const hasKey = Boolean(draft.market === 'TW' ? state.settings.fugleKey : state.settings.finnhubKey);
    const stock: Stock = { ...draft, id: crypto.randomUUID(), order, alertLatches: { above: false, below: false }, quoteStatus: hasKey ? 'no-trade' : 'not-connected' };
    const result = await persist({ type: 'add-stock', stock });
    if (result) { setStockDialog(null); setToast(`已加入 ${stock.symbol}，取得首筆行情後會顯示最新價格。`); }
  }

  async function updateStock(stockId: string, draft: StockDraft) {
    const previous = state.stocks.find((stock) => stock.id === stockId);
    if (!previous) return;
    const identityChanged = previous.market !== draft.market || previous.symbol.toUpperCase() !== draft.symbol.toUpperCase();
    const ruleChanged = previous.alert.above !== draft.alert.above || previous.alert.below !== draft.alert.below;
    const patch: Partial<Stock> = { ...draft };
    if (identityChanged) Object.assign(patch, { quote: undefined, quoteStatus: (draft.market === 'TW' ? state.settings.fugleKey : state.settings.finnhubKey) ? 'no-trade' : 'not-connected', quoteError: undefined, pendingNotification: undefined, notificationFailure: undefined }, resetAlertLatches(previous, draft.alert));
    else if (ruleChanged) Object.assign(patch, resetAlertLatches(previous, draft.alert), { pendingNotification: undefined, notificationFailure: undefined });
    const result = await persist({ type: 'patch-stock', stockId, patch });
    if (result) { setStockDialog(null); setToast(ruleChanged ? '股票資料已更新，到價提醒已重新啟用。' : '股票資料已更新。'); }
  }

  async function moveStock(stock: Stock, groupId: string, index: number) {
    await persist({ type: 'place-stock', stockId: stock.id, groupId, index });
  }

  async function removeStock(stock: Stock) {
    if (!window.confirm(`確定移除 ${stock.customLabel || stock.name}（${stock.symbol}）嗎？`)) return;
    const result = await persist({ type: 'delete-stock', stockId: stock.id });
    if (result) setToast(`${stock.symbol} 已移除。`);
  }

  async function saveGroup(name: string) {
    if (groupDialog?.group) {
      const group = { ...groupDialog.group, name };
      const result = await persist({ type: 'update-group', group });
      if (result) { setGroupDialog(null); setToast('分區名稱已更新。'); }
    } else {
      const group: StockGroup = { id: crypto.randomUUID(), name, order: Math.max(-1, ...state.groups.map((item) => item.order)) + 1 };
      const result = await persist({ type: 'add-group', group });
      if (result) { setGroupDialog(null); setToast(`已新增「${name}」分區。`); }
    }
  }

  async function deleteCurrentGroup(moveToGroupId?: string, deleteStocks?: boolean) {
    if (!deleteGroup) return;
    const result = await persist({ type: 'delete-group', groupId: deleteGroup.id, moveToGroupId, deleteStocks });
    if (result) { setToast(deleteStocks ? `「${deleteGroup.name}」與其中股票已移除。` : `「${deleteGroup.name}」已刪除，股票已移至其他分區。`); setDeleteGroup(null); }
  }

  async function changeGroupOrder(group: StockGroup, offset: number) {
    const groups = [...sortedGroups];
    const from = groups.findIndex((item) => item.id === group.id);
    const to = from + offset;
    if (to < 0 || to >= groups.length) return;
    [groups[from], groups[to]] = [groups[to]!, groups[from]!];
    await persist({ type: 'reorder-groups', groupIds: groups.map((item) => item.id) });
  }

  async function refreshQuotes(stockId?: string) {
    if (!browserExtensionAvailable()) {
      setToast('本機預覽不會呼叫行情 API。安裝擴充功能後，背景服務會依額度更新。');
      return;
    }
    setRefreshing(true); setToast('');
    try {
      const result = await chrome.runtime.sendMessage({ type: 'REFRESH_QUOTES', ...(stockId ? { stockId } : {}) });
      if (result?.error) setToast(result.error);
      else if (!result?.refreshed) setToast(result?.skipped ? '已依行情來源額度安排輪替，請稍後查看。' : '尚無可更新的股票，請先設定 API 金鑰。');
      else setToast(`已更新 ${result.refreshed} 檔行情${result.skipped ? `，另有 ${result.skipped} 檔將稍後輪替` : ''}。`);
    } catch { setToast('背景服務暫時沒有回應，請稍後再試。'); }
    finally { setRefreshing(false); }
  }

  async function retryNotification(stock: Stock) {
    if (!browserExtensionAvailable()) { setToast('通知重試需在 Chrome 擴充功能中進行。'); return; }
    try {
      const result = await chrome.runtime.sendMessage({ type: 'RETRY_NOTIFICATION', stockId: stock.id });
      if (result?.error) setToast(result.error);
      else if (result?.ok === true) setToast('已重新送出提醒通知。');
      else setToast('未收到通知傳送結果，請稍後再試。');
    } catch { setToast('背景服務暫時沒有回應，請稍後再試。'); }
  }

  async function testNotification() {
    if (!state.settings.notificationsEnabled || state.settings.notificationPermission !== 'granted') throw new Error('請先開啟通知權限。');
    if (browserExtensionAvailable()) {
      const result = await chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
      if (result?.error) throw new Error(result.error);
      return '測試通知已送出。';
    }
    if (typeof Notification !== 'undefined') { new Notification('山嵐股票桌面', { body: '這是一則測試通知，到價提醒已準備就緒。' }); return '測試通知已送出。'; }
    throw new Error('此瀏覽器不支援通知。');
  }

  async function saveNotificationSettings(enabled: boolean, permission: NotificationPermission | 'unsupported') {
    await persist({ type: 'update-notification-settings', notificationsEnabled: enabled, notificationPermission: permission });
  }

  const groupsWithStocks = sortedGroups.map((group) => ({ ...group, stocks: state.stocks.filter((stock) => stock.groupId === group.id).sort((a, b) => a.order - b.order) }));

  return <main className="desktop-shell">
    <div className="background-image" aria-hidden="true" style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")`, filter: `brightness(${state.background.brightness})` } : undefined} />
    <div className="ambient" aria-hidden="true" />
    <header className="topbar">
      <a className="brand" href="#top" aria-label="山嵐股票桌面首頁"><span className="brand-mark" aria-hidden="true">山</span><span><b>山嵐</b><small>股票桌面</small></span></a>
      <time className="date-label" dateTime={dateNow.toISOString()} aria-label={`${displayedDate.gregorian}，農曆${displayedDate.lunar}`}>
        <span className="date-gregorian">{displayedDate.gregorian}</span>
        <span className="date-lunar">農曆 {displayedDate.lunar}</span>
      </time>
      <div className="top-actions"><span className={`connection ${status.tone}`}><i />{status.label}</span><button className="icon-button top-refresh" aria-label="立即更新行情" title="立即更新行情" onClick={() => void refreshQuotes()} disabled={refreshing || state.stocks.length === 0}><Icon name="refresh" size={17} className={refreshing ? 'spinning' : ''} /></button><button className="icon-button" aria-label="設定" title="設定" onClick={() => setSettingsOpen(true)}><Icon name="settings" size={18} /></button><button className="primary-button add-stock-button" onClick={() => setStockDialog({})}><Icon name="plus" size={16} />新增股票</button></div>
    </header>

    <div id="top" className={`page-content ${state.stocks.length ? 'has-stocks' : 'is-empty'}`}>
      {!welcomeHidden && (!state.stocks.length ? <section className="welcome">
        <button type="button" className="icon-button welcome-close" aria-label="隱藏問候區" title="隱藏問候區" onClick={() => void persist({ type: 'update-settings', settings: { welcomeManuallyHidden: true } })}><Icon name="close" size={16} /></button>
        <p className="eyebrow">市場觀察 · 台股與美股</p><h1>讓時間，留給<br /><em>真正重要的事。</em></h1><p className="welcome-copy">一眼看見你的台股與美股，安靜追蹤每一次變化。</p>
        <button className="welcome-cta" onClick={() => setStockDialog({})}><Icon name="plus" size={16} />加入第一檔股票<Icon name="arrow" size={16} /></button>
      </section> : <section className="welcome compact-welcome">
        <div><p className="eyebrow">市場觀察 · 台股與美股</p><h1>{getTaipeiGreeting(dateNow)}</h1></div><div className="welcome-controls"><button type="button" className="icon-button welcome-close" aria-label="隱藏問候區" title="隱藏問候區" onClick={() => void persist({ type: 'update-settings', settings: { welcomeManuallyHidden: true } })}><Icon name="close" size={16} /></button><button className="secondary-button refresh-label" onClick={() => void refreshQuotes()} disabled={refreshing}><Icon name="refresh" size={16} className={refreshing ? 'spinning' : ''} />{refreshing ? '更新中…' : '更新行情'}</button></div>
      </section>)}

      <section className="portfolio" aria-label="股票分區">
        <div className="portfolio-heading"><div><p className="eyebrow">我的觀察清單</p><h2>你的投資組合 <span>{state.stocks.length.toString().padStart(2, '0')}</span></h2></div><button type="button" className="text-action add-group-action" onClick={() => setGroupDialog({})}><Icon name="plus" size={15} />新增分區</button></div>
        {loading && <p className="loading-note">正在載入本機資料…</p>}
        {groupsWithStocks.map((group, groupIndex) => <section key={group.id} className="stock-group" aria-label={`${group.name}分區`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const stock = state.stocks.find((item) => item.id === draggingId); if (stock && stock.groupId !== group.id) void moveStock(stock, group.id, group.stocks.length); setDraggingId(null); }}>
          <header className="group-header"><div className="group-title"><span className={`group-marker ${group.id === 'group-us' ? 'us' : ''}`} /><h2>{group.name}</h2><span className="group-count">{group.stocks.length}</span></div><div className="group-actions"><button type="button" className="mini-icon-button" aria-label={`將${group.name}分區上移`} onClick={() => void changeGroupOrder(group, -1)} disabled={groupIndex === 0}><Icon name="up" size={15} /></button><button type="button" className="mini-icon-button" aria-label={`將${group.name}分區下移`} onClick={() => void changeGroupOrder(group, 1)} disabled={groupIndex === sortedGroups.length - 1}><Icon name="down" size={15} /></button><button type="button" className="mini-icon-button" aria-label={`重新命名${group.name}分區`} onClick={() => setGroupDialog({ group })}><Icon name="edit" size={15} /></button><button type="button" className="mini-icon-button danger-icon" aria-label={`刪除${group.name}分區`} disabled={state.groups.length < 2} onClick={() => setDeleteGroup(group)}><Icon name="trash" size={15} /></button><button type="button" className="group-add" onClick={() => setStockDialog({ groupId: group.id })}><Icon name="plus" size={14} />加入股票</button></div></header>
          {group.stocks.length ? <div className="stock-grid">{group.stocks.map((stock) => <StockCard key={stock.id} stock={stock} groups={sortedGroups} dragging={draggingId === stock.id} onEdit={() => setStockDialog({ stock })} onRemove={() => void removeStock(stock)} onMove={(targetId, index) => void moveStock(stock, targetId, index)} onGainDisplayChange={() => void persist({ type: 'patch-stock', stockId: stock.id, patch: { gainDisplay: stock.gainDisplay === 'percent' ? 'money' : 'percent' } })} onRetryNotification={() => void retryNotification(stock)} onDragStart={() => setDraggingId(stock.id)} onDrop={(index) => { const source = state.stocks.find((item) => item.id === draggingId); if (source) void moveStock(source, stock.groupId, index); setDraggingId(null); }} />)}</div> : <div className="group-empty"><div className="empty-symbol">{group.id === 'group-us' ? '$' : <Icon name="chart" size={17} />}</div><div><b>尚未加入股票</b><p>加入追蹤清單，讓重要報價一目了然。</p></div><button type="button" className="text-action" onClick={() => setStockDialog({ groupId: group.id })}>新增一檔<Icon name="arrow" size={14} /></button></div>}
        </section>)}
        {!sortedGroups.length && <div className="no-groups"><p>尚未建立分區</p><button className="secondary-button" onClick={() => setGroupDialog({})}>新增第一個分區</button></div>}
      </section>
      <footer className="disclaimer">個人觀察用途 · 價格依行情來源更新 · 損益不含交易成本與股息 <time className="build-meta" dateTime={BUILD_TIMESTAMP} aria-label={BUILD_META_LABEL} title={BUILD_META_LABEL}>（v{APP_VERSION} · {BUILD_META_SHORT_TIME}）</time></footer>
    </div>

    <footer className="credit">
      <div className="photo-credit">{activeBackground ? <><a href={activeBackground.source} target="_blank" rel="noreferrer">{activeBackground.label} · {activeBackground.author}</a><span>照片</span></> : state.background.selectedId === 'custom' ? <span>自訂背景 · 僅儲存於本機</span> : <span>山林清晨 · 風景背景</span>}</div>
    </footer>
    {toast && <div className="toast" role="status"><span>{toast}</span><button type="button" aria-label="關閉提示" onClick={() => setToast('')}><Icon name="close" size={15} /></button></div>}
    {stockDialog && <StockFormDialog key={stockDialog.stock?.id ?? `new-${stockDialog.groupId ?? 'default'}`} state={state} stock={stockDialog.stock} initialGroupId={stockDialog.groupId} onClose={() => setStockDialog(null)} onSave={(draft) => stockDialog.stock ? void updateStock(stockDialog.stock.id, draft) : void addStock(draft)} lookupSymbolName={browserExtensionAvailable() ? lookupStockName : undefined} />}
    {groupDialog && <GroupForm group={groupDialog.group} onClose={() => setGroupDialog(null)} onSave={(name) => void saveGroup(name)} />}
    {deleteGroup && <DeleteGroupDialog group={deleteGroup} count={state.stocks.filter((stock) => stock.groupId === deleteGroup.id).length} groups={sortedGroups.filter((group) => group.id !== deleteGroup.id)} onClose={() => setDeleteGroup(null)} onConfirm={(targetId, deleteStocks) => void deleteCurrentGroup(targetId, deleteStocks)} />}
    {settingsOpen && <SettingsDrawer state={state} backgrounds={catalog} hasBackground={Boolean(customBackgroundUrl)} onClose={() => setSettingsOpen(false)} onSaveKeys={async (fugleKey, finnhubKey) => { const result = await persist({ type: 'update-settings', settings: { fugleKey, finnhubKey } }); if (!result) throw new Error('儲存 API 金鑰失敗'); }} onSettingsChange={async (settings) => { const result = await persist({ type: 'update-settings', settings }); if (!result) throw new Error('儲存設定失敗'); }} onBackgroundChange={async (selectedId, brightness) => { const result = await persist({ type: 'update-background', background: { selectedId, brightness } }); if (!result) throw new Error('儲存背景設定失敗'); }} onRestoreWelcome={async () => { const result = await persist({ type: 'update-settings', settings: { welcomeManuallyHidden: false } }); if (!result) throw new Error('恢復問候區自動顯示失敗'); }} onTestNotification={testNotification} onNotificationChange={saveNotificationSettings} />}
  </main>;
}
