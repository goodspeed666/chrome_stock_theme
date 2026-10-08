import { useEffect, useRef, useState } from 'react';
import type { AppSettings, AppState } from '../domain/types';
import type { BackgroundImage } from '../data/backgrounds';
import { ACCOUNT_SYNC_META_KEY } from '../data/accountSync';
import { STATE_KEY } from '../data/storage';
import { removeUploadedBackground, saveUploadedBackground } from '../data/images';
import { Dialog } from './Dialog';
import { Icon } from './Icons';

type AccountSyncPhase = 'disabled' | 'conflict' | 'error' | 'pending' | 'written' | 'ready';

interface AccountSyncStatus {
  enabled: boolean;
  phase: AccountSyncPhase;
  message: string;
}

type AccountSyncMessage =
  | { type: 'ACCOUNT_SYNC_STATUS' }
  | { type: 'ACCOUNT_SYNC_SET_ENABLED'; enabled: boolean }
  | { type: 'ACCOUNT_SYNC_RESOLVE'; choice: 'local' | 'sync' }
  | { type: 'ACCOUNT_SYNC_RETRY' };

interface SettingsDrawerProps {
  state: AppState;
  backgrounds: BackgroundImage[];
  onClose: () => void;
  onSaveKeys: (fugleKey: string, finnhubKey: string) => Promise<void>;
  onBackgroundChange: (selectedId: string, brightness?: number) => Promise<void>;
  onRestoreWelcome: () => Promise<void>;
  onTestNotification: () => Promise<string>;
  onNotificationChange: (enabled: boolean, permission: NotificationPermission | 'unsupported') => Promise<void>;
  onSettingsChange: (settings: Partial<Pick<AppSettings, 'limitNotificationsEnabled' | 'quoteRefreshSeconds'>>) => Promise<void>;
  hasBackground: boolean;
}

export function SettingsDrawer({ state, backgrounds, onClose, onSaveKeys, onBackgroundChange, onRestoreWelcome, onTestNotification, onNotificationChange, onSettingsChange, hasBackground }: SettingsDrawerProps) {
  const [fugleKey, setFugleKey] = useState(state.settings.fugleKey);
  const [finnhubKey, setFinnhubKey] = useState(state.settings.finnhubKey);
  const [brightness, setBrightness] = useState(state.background.brightness);
  const [savingKeys, setSavingKeys] = useState(false);
  const [savedKeys, setSavedKeys] = useState(false);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [restoringWelcome, setRestoringWelcome] = useState(false);
  const [accountSyncStatus, setAccountSyncStatus] = useState<AccountSyncStatus | null>(null);
  const [accountSyncBusy, setAccountSyncBusy] = useState(false);
  const syncRequestId = useRef(0);
  const mounted = useRef(false);
  const extensionAvailable = typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

  useEffect(() => { setFugleKey(state.settings.fugleKey); setFinnhubKey(state.settings.finnhubKey); setBrightness(state.background.brightness); }, [state.settings.fugleKey, state.settings.finnhubKey, state.background.brightness]);

  useEffect(() => {
    mounted.current = true;
    if (!extensionAvailable) return () => { mounted.current = false; };

    let timer: number | undefined;
    const refreshStatus = async () => {
      const requestId = ++syncRequestId.current;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'ACCOUNT_SYNC_STATUS' });
        if (!mounted.current || requestId !== syncRequestId.current) return;
        if (response?.error) throw new Error(response.error);
        if (!response?.status) throw new Error('無法讀取同步狀態');
        setAccountSyncStatus(response.status as AccountSyncStatus);
      } catch (error) {
        if (!mounted.current || requestId !== syncRequestId.current) return;
        setAccountSyncStatus({ enabled: state.settings.accountSyncEnabled, phase: 'error', message: error instanceof Error ? error.message : '無法讀取同步狀態' });
      }
    };
    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || (!changes[ACCOUNT_SYNC_META_KEY] && !changes[STATE_KEY])) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; void refreshStatus(); }, 80);
    };

    void refreshStatus();
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      mounted.current = false;
      syncRequestId.current += 1;
      if (timer !== undefined) window.clearTimeout(timer);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [extensionAvailable, state.settings.accountSyncEnabled]);

  async function runAccountSyncAction(message: AccountSyncMessage) {
    if (!extensionAvailable || accountSyncBusy) return;
    setAccountSyncBusy(true);
    const requestId = ++syncRequestId.current;
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response?.error) throw new Error(response.error);
      if (!response?.status) throw new Error('未收到同步狀態，請稍後再試。');
      if (mounted.current && requestId === syncRequestId.current) setAccountSyncStatus(response.status as AccountSyncStatus);
    } catch (error) {
      if (mounted.current && requestId === syncRequestId.current) setAccountSyncStatus({
        enabled: state.settings.accountSyncEnabled,
        phase: 'error',
        message: error instanceof Error ? error.message : '同步操作失敗，請稍後再試。',
      });
    } finally {
      if (mounted.current) setAccountSyncBusy(false);
    }
  }

  async function saveKeys(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingKeys(true); setMessage(''); setSavedKeys(false);
    try { await onSaveKeys(fugleKey.trim(), finnhubKey.trim()); setSavedKeys(true); setMessage('行情金鑰已儲存在本機。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '無法儲存金鑰'); }
    finally { setSavingKeys(false); }
  }

  async function chooseUpload(file?: File) {
    if (!file) return;
    setUploading(true); setMessage('');
    try { await saveUploadedBackground(file); await onBackgroundChange('custom', brightness); setMessage('自訂背景已儲存在本機。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '圖片儲存失敗'); }
    finally { setUploading(false); }
  }

  async function saveBrightness() {
    try { await onBackgroundChange(state.background.selectedId, brightness); setMessage('背景亮度已更新。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '設定儲存失敗'); }
  }

  async function resetBackground() {
    try { await removeUploadedBackground(); const first = backgrounds[0]?.id ?? 'default'; await onBackgroundChange(first, 0.58); setBrightness(0.58); setMessage('已還原預設背景。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '無法還原背景'); }
  }

  async function enableNotifications() {
    setEnabling(true); setMessage('');
    let permission: NotificationPermission | 'unsupported' = 'unsupported';
    if (typeof Notification !== 'undefined') permission = await Notification.requestPermission();
    await onNotificationChange(permission === 'granted', permission);
    setMessage(permission === 'granted' ? '到價提醒已開啟。' : permission === 'denied' ? '瀏覽器已封鎖通知，請在網站設定中允許。' : '此瀏覽器不支援通知。');
    setEnabling(false);
  }

  async function testNotification() {
    setTesting(true); setMessage('');
    try { setMessage(await onTestNotification()); }
    catch (error) { setMessage(error instanceof Error ? error.message : '測試通知失敗'); }
    finally { setTesting(false); }
  }

  async function restoreWelcome() {
    setRestoringWelcome(true); setMessage('');
    try { await onRestoreWelcome(); setMessage('問候區已恢復自動顯示。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '恢復問候區設定失敗'); }
    finally { setRestoringWelcome(false); }
  }

  async function savePreference(settings: Partial<Pick<AppSettings, 'limitNotificationsEnabled' | 'quoteRefreshSeconds'>>) {
    setMessage('');
    try { await onSettingsChange(settings); }
    catch (error) { setMessage(error instanceof Error ? error.message : '設定儲存失敗'); }
  }

  const permissionText = state.settings.notificationPermission === 'granted' ? '已允許' : state.settings.notificationPermission === 'denied' ? '已封鎖' : state.settings.notificationPermission === 'unsupported' ? '不支援' : '尚未選擇';

  return <Dialog title="設定" description="金鑰、提醒與背景都保存在這部裝置。" onClose={onClose} className="settings-drawer" closeLabel="關閉設定">
    <div className="settings-scroll">
      <section className="settings-section">
        <div className="settings-section-heading"><span className="section-icon"><Icon name="refresh" /></span><div><h3>行情來源</h3><p>使用個人 API 金鑰取得行情快照。</p></div></div>
        <form className="stack-form" onSubmit={saveKeys}>
          <label>Fugle 台股 API Key<input type="password" value={fugleKey} onChange={(event) => { setFugleKey(event.target.value); setSavedKeys(false); }} autoComplete="off" spellCheck="false" placeholder="貼上 Fugle API Key" /></label>
          <div className="provider-link-row"><a className="provider-link" href="https://developer.fugle.tw/" target="_blank" rel="noreferrer">前往 Fugle 開發者平台 <Icon name="arrow" size={13} /></a><span className="free-apply-badge">可免費申請</span></div>
          <label>Finnhub 美股 Token<input type="password" value={finnhubKey} onChange={(event) => { setFinnhubKey(event.target.value); setSavedKeys(false); }} autoComplete="off" spellCheck="false" placeholder="貼上 Finnhub Token" /></label>
          <div className="provider-link-row"><a className="provider-link" href="https://finnhub.io/dashboard" target="_blank" rel="noreferrer">前往 Finnhub 控制台 <Icon name="arrow" size={13} /></a><span className="free-apply-badge">可免費申請</span></div>
          <div className="inline-action"><button type="submit" className="secondary-button" disabled={savingKeys}>{savingKeys ? '儲存中…' : '儲存 API 金鑰'}</button>{savedKeys && <span className="success-note"><Icon name="check" size={15} />已儲存</span>}</div>
        </form>
        <p className="privacy-note">金鑰只保存在本機擴充功能儲存區，僅用於呼叫對應行情 API，不會寫入日誌。</p>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><span className="section-icon"><Icon name="bell" /></span><div><h3>到價提醒</h3><p>報價來源回傳新成交後，符合條件時提醒一次。</p></div></div>
        <div className="permission-row"><span>瀏覽器通知權限</span><b className={`permission-state ${state.settings.notificationPermission}`}>{permissionText}</b></div>
        {!state.settings.notificationsEnabled ? <button type="button" className="secondary-button full-action" onClick={() => void enableNotifications()} disabled={enabling}>{enabling ? '等待瀏覽器回應…' : '開啟到價提醒'}</button> : <div className="enabled-notice"><Icon name="check" size={15} />到價提醒已開啟</div>}
        <button type="button" className="text-action" onClick={() => void testNotification()} disabled={testing || state.settings.notificationPermission !== 'granted'}>{testing ? '測試中…' : '傳送測試通知'}</button>
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><span className="section-icon"><Icon name="bell" /></span><div><h3>台股漲跌停通知</h3><p>僅使用 Fugle 成交回報的限價旗標，不參考委買委賣或推算價格。</p></div></div>
        <label className="setting-toggle-row"><span><b>啟用漲跌停通知</b><small>僅限台股，每檔每方向每日一次；須開啟到價提醒並允許瀏覽器通知。</small></span><input type="checkbox" aria-label="台股漲跌停通知" checked={state.settings.limitNotificationsEnabled} onChange={(event) => void savePreference({ limitNotificationsEnabled: event.target.checked })} /></label>
        {(!state.settings.notificationsEnabled || state.settings.notificationPermission !== 'granted') && <p className="limit-notification-prompt" role="note">目前通知尚未就緒。請開啟到價提醒並允許瀏覽器通知後，才會傳送漲跌停提醒。</p>}
      </section>

      <section className="settings-section">
        <div className="settings-section-heading"><span className="section-icon"><Icon name="refresh" /></span><div><h3>Chrome 帳號同步</h3><p>選擇是否將部分投資組合資料同步至 Chrome 帳戶，預設關閉。</p></div></div>
        <label className="setting-toggle-row"><span><b>同步投資組合</b><small>同步股票、分區、成本、提醒門檻、一般偏好與內建背景。</small></span><input type="checkbox" aria-label="Chrome 帳號同步" checked={state.settings.accountSyncEnabled} disabled={!extensionAvailable || accountSyncBusy} onChange={(event) => void runAccountSyncAction({ type: 'ACCOUNT_SYNC_SET_ENABLED', enabled: event.target.checked })} /></label>
        <p className="account-sync-local-note">API 金鑰、通知權限與總開關、自訂背景圖片仍只保存在這部裝置。兩台裝置需登入同一 Google 帳戶、開啟 Chrome 同步，並使用相同的擴充功能 ID。</p>
        {!extensionAvailable ? <p className="account-sync-status" role="note">本機預覽不支援 Chrome 帳號同步；請載入 Chrome 擴充功能後使用。</p> : <>
          <p className={`account-sync-status${accountSyncStatus?.phase === 'error' ? ' error' : ''}`} role={accountSyncStatus?.phase === 'error' ? 'alert' : 'status'}>{accountSyncBusy ? '同步設定處理中…' : accountSyncStatus?.message ?? '正在讀取同步狀態…'}</p>
          {accountSyncStatus?.phase === 'conflict' && <div className="account-sync-actions"><button type="button" className="secondary-button" onClick={() => void runAccountSyncAction({ type: 'ACCOUNT_SYNC_RESOLVE', choice: 'local' })} disabled={accountSyncBusy}>使用這台電腦的設定</button><button type="button" className="secondary-button" onClick={() => void runAccountSyncAction({ type: 'ACCOUNT_SYNC_RESOLVE', choice: 'sync' })} disabled={accountSyncBusy}>使用已同步的設定</button></div>}
          {(accountSyncStatus?.phase === 'pending' || accountSyncStatus?.phase === 'error') && <button type="button" className="secondary-button full-action" onClick={() => void runAccountSyncAction({ type: 'ACCOUNT_SYNC_RETRY' })} disabled={accountSyncBusy}>{accountSyncBusy ? '重試中…' : '重試同步'}</button>}
        </>}
      </section>

      {state.settings.welcomeManuallyHidden && <section className="settings-section">
        <div className="settings-section-heading"><span className="section-icon"><Icon name="refresh" /></span><div><h3>問候區</h3><p>手動隱藏中的問候區，可恢復依追蹤市場開盤狀態自動顯示。</p></div></div>
        <button type="button" className="secondary-button full-action" onClick={() => void restoreWelcome()} disabled={restoringWelcome}>{restoringWelcome ? '恢復中…' : '恢復問候區自動顯示'}</button>
      </section>}

      <section className="settings-section">
        <div className="settings-section-heading"><span className="section-icon"><Icon name="photo" /></span><div><h3>風景背景</h3><p>十張 CC0 照片可選，也可使用本機圖片。</p></div></div>
        <div className="background-picker" role="radiogroup" aria-label="選擇背景照片">
          {backgrounds.map((background) => <button key={background.id} type="button" role="radio" aria-checked={state.background.selectedId === background.id} className={`background-option ${state.background.selectedId === background.id ? 'selected' : ''}`} onClick={() => { void onBackgroundChange(background.id, brightness); }}>
            <img src={`/${background.thumbnail}`} alt="" loading="lazy" /><span><b>{background.label}</b><small>{background.author}</small></span><i aria-hidden="true"><Icon name="check" size={14} /></i>
          </button>)}
        </div>
        <div className="custom-background-card">
          <div><b>自訂背景</b><small>JPEG、PNG、WebP · 最多 15 MB · 僅儲存於本機</small></div>
          <label className="file-button">{uploading ? '載入中…' : '選擇圖片'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { void chooseUpload(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} /></label>
          {state.background.selectedId === 'custom' && hasBackground && <span className="custom-active">目前使用</span>}
        </div>
        <label className="range-label">背景亮度 <b>{Math.round(brightness * 100)}%</b><input type="range" min="0.35" max="0.9" step="0.01" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} onPointerUp={() => void saveBrightness()} onKeyUp={() => void saveBrightness()} /></label>
        <button type="button" className="text-action" onClick={() => void resetBackground()}>還原預設背景</button>
      </section>
      <section className="settings-section limitations">
        <h3>行情更新間隔</h3>
        <label className="refresh-interval-field">行情更新間隔<select aria-label="行情更新間隔" value={state.settings.quoteRefreshSeconds} onChange={(event) => void savePreference({ quoteRefreshSeconds: Number(event.target.value) as AppSettings['quoteRefreshSeconds'] })}><option value="30">30 秒</option><option value="60">1 分鐘</option><option value="120">2 分鐘</option><option value="300">5 分鐘</option></select></label>
        <p>依來源額度輪替候選股票，不保證每檔都按固定間隔更新。</p>
        <p>Chrome 完全關閉、電腦休眠或離線時，提醒無法保證即時送達；恢復後會依下一筆新成交判斷。</p><p>台股來源：Fugle · 美股來源：Finnhub</p>
      </section>
      {message && <p className="settings-message" role="status">{message}</p>}
    </div>
  </Dialog>;
}
