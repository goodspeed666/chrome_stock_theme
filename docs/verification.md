# 驗證紀錄

2026-10-08，本機最終原始碼及 `dist/` 建置結果。

## 自動化

- `npm test`：8 個測試檔、52 項通過。
- `npm run typecheck`：通過。
- `npm run build`：通過。
- `npm run test:e2e`：6 項通過，涵蓋股票／分區操作、排序、損益切換、設定保存、背景選擇／上傳／重載與連續替換。
- 隔離 Chromium 實際載入 `dist/`：確認 Manifest V3 worker、新分頁入口、30 秒 alarm、Chrome storage、無金鑰不發送行情請求、相同時間戳行情狀態更新、供應商限流停止後續批次、過期待送通知的提示與清除。
- 建置產物包含 10 張 CC0 原圖及縮圖，manifest 引用檔案完整；ZIP 解壓完整性檢查通過。

## 畫面與操作

在既有 Chrome 的本機預覽實測股票新增／編輯／重載、分區移動／刪除、門檻驗證及自訂背景保存。設定輸入文字 16px、說明 14px、標題 24px；375px 寬度無橫向溢出，分區排序按鈕仍可使用。

規格審查與程式品質審查已完成，已修復發現的阻擋問題。截圖存於 `artifacts/`；範例行情截圖有「測試資料（非即時行情）」標記。

## 尚未以真實環境驗證

尚未使用個人 Fugle／Finnhub 金鑰驗證實際行情，也未驗證作業系統通知送達。通知建立成功／失敗與既有通知去重分支仍缺少 API fixture 覆蓋；目前已測試通知權限防護與過期重試。沒有在使用者 Chrome 設定檔安裝擴充功能。

## 安裝包

`artifacts/chrome-stock-desktop.zip` 的根目錄包含 `manifest.json`，解壓後可在 Chrome「載入未封裝項目」選擇該目錄。也可直接載入專案 `dist/`。

SHA-256：`377a279e9bb241e3675a602d49cf91ffc8d5159af1df1e8c0dace43d085ef3a4`

日期更新驗證：公曆 24px、農曆 16px，星期使用全形括號；台北凌晨顯示夜深問候。涵蓋農曆初一／初十／二十／三十、閏月與跨日；375px 無橫向溢出。

日期置中修正：build 與日期 E2E 通過；既有 Chrome 實測 375/768/1024/1440px 中心誤差不超過 0.004px，無重疊或橫向溢出。

緊湊卡片與自動名稱更新：套用 ui-ux-pro-max 的字級與資訊排列建議，股票名稱20px、基本無行情卡132px；375/768/1024/1440px實測無溢出。新增表單不再手動填名稱，擴充功能以既有金鑰查詢，支援debounce、舊回應隔離、成功快取及共享請求額度。52單元與6 E2E通過；最後查名文字14px調整後重新build及loaded-extension E2E通過。自動查名的供應商回應使用fixture，尚未驗證個人金鑰實際連線。

頁尾版本與更新時間：版本取自 package.json，時間固定為建置時間並以台北時間顯示。型別檢查、建置與相關 E2E（1/1）通過；Chrome 預覽確認 12px 字體、375px 無水平溢位。截圖：artifacts/footer-version.png。

頁尾精簡版：版本與 MM/DD HH:mm 移至圖片資訊同列左側，完整台北建置時間保留於提示文字。相關 E2E 1/1、型別檢查與建置通過，Chrome 確認 375px 左距 17px 且無水平溢位。

最新頁尾位置：版本與短更新時間以全形括號接在用途說明末尾，圖片來源保留右側。型別檢查、建置與 focused footer E2E 1/1 通過；Chrome 確認括弧資訊位於 disclaimer 內且 375px 無水平溢位。

問候區自動隱藏：依實際追蹤市場，任一一般盤開盤時隱藏，收盤恢復；手動隱藏持久保存，設定可恢復自動模式。官方2026台美日曆、DST、休市/早收盤邊界納入，未知年保守顯示，未追蹤臨時休市公告。59 unit、typecheck、build、focused greeting E2E 2/2 通過，review無阻擋；Chrome live手動隱藏→reload保持→設定恢復均通過。未重跑全套E2E。

設定開啟速度：取消設定專屬 backdrop fade/blur 和 drawer 動畫，其他 Dialog 不變。build 與 focused settings E2E 1/1 通過（focus、Tab trap、375px、一般 Dialog）。本輪 Chrome connector 不可用，驗證為隔離 Chromium，未宣稱使用者 Chrome 實測。截圖 artifacts/settings-fast-open.png。

股票名稱輸入框：查詢成功名稱移入代號框右側，代號value獨立；名稱14px、省略長名並保留title。lookup unit 5/5、build、built-extension focused E2E 1/1 通過，含375px無重疊/溢位。沿用原有lookup來源，未增加股票名錄；截圖使用測試行情回應。

漲跌停提醒與更新間隔：台股採 Fugle 最後成交價漲跌停旗標，每台北交易日/代號/方向成功通知一次，試撮、暫停及過期成交排除；toggle 預設true，仍受通知總開關/權限限制，threshold與limit獨立pending與重試。間隔30/60/120/300秒、預設30，修改立即套用alarm且啟動恢復。62 unit、typecheck、build、完整E2E11/11通過；review無阻擋。通知驗證使用mock chrome.notifications.create（包含成功/失敗/重試），不代表真實個人API或OS通知驗證。
