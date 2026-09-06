# Pocket Maple · 口袋公聽

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/mashbean/pocket-maple)

對一個**法案或公聽案**留下立場與書面意見、公開存檔，做成一個 Cloudflare Worker，不用帳號、不用模型、不用 token。主辦者從立法院搜法律、挑本屆的法案直接帶入（提案人、狀態、案由、議案流程都是即時快照），或手動輸入公聽會、地方議會的案子；每人留下立場（支持／反對／修正）、一句話重點與書面意見；公開檔案頁可依立場篩選、搜尋；匯出 `testimonies.csv`、`archive.json` 與 `tttc.csv`（一句話重點，可接 Pocket TTTC 或 Pocket Reply）。

形狀來自美國麻州的 [MAPLE](https://github.com/codeforboston/maple)（MIT，未用其程式碼）；法案資料來自 [OpenFun 維護的立法院 API](https://ly.govapi.tw)（`v2.ly.govapi.tw`，免 token）：`/laws?q=` 搜法律名稱與別名、`/bills?法律編號=&屆=11` 列法案、`/bills/:id` 取快照。

## 與 MAPLE 的差別

- MAPLE 要求登入實名；這裡不驗證身分，每份證詞旁標示「未驗證身分」，一台裝置一份，截止前可修改或撤回。
- 只做書面意見與公開檔案；沒有 MAPLE 的議員通知、立法進度追蹤與翻譯。
- 法案快照在建立時抓一次存進 Durable Object，之後不依賴上游；頁面提供立法院原始連結。

## API

```
GET    /api/laws?q=                               搜法律（免 token）
GET    /api/bills?law=<5碼法律編號>                 本屆相關法案
GET    /api/bills?no=<15碼議案編號或 ppg 網址>       單一法案快照
POST   /api/hearings                              {billNo} 或 {agenda:{name, proposer?, status?, laws?, url?, reason?}}, title?, description?, deadline?(YYYY-MM-DD), askOrg?, requireSummary?, confirmed:true
GET    /api/hearings/:id                          公開設定、議程快照與立場計數
GET    /api/hearings/:id/testimonies              {hearing, testimonies}（公開檔案）
POST   /api/hearings/:id/testimonies              {participantId, stance: support|oppose|amend, name, org?, summary, text}
POST   /api/hearings/:id/me | withdraw            {participantId}
POST   /api/hearings/:id/testimonies/:n/remove    X-Hearing-Admin（下架）
GET    /api/hearings/:id/host | export/testimonies.csv | tttc.csv | archive.json   X-Hearing-Admin 或 ?token=
POST   /api/hearings/:id/status                   X-Hearing-Admin {status}
DELETE /api/hearings/:id                          X-Hearing-Admin
```

```bash
npm install && npm test && npm run check
npm run deploy:production    # 網域在 env.production.routes；Worker 名稱不可改
```

MIT 授權。
