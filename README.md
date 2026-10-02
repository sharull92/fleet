# Fleet Ops — Fleet Swis Group

Web app untuk sistem fleet: Dashboard, Driver & Requester (workshop ticket & job request),
Repair & Maintenance (compliance register road tax / inspection / insurance / JKKP / APAD),
Costing, Hiring Management, Utilization, New / Dispose dan Settings WhatsApp.

Dibina dari prototype `fleet_dashboard_workshop_ticket_updated_8.html`. Prototype itu
simpan data dalam storage artifact Claude; app ini simpan data dalam **database SQLite di
server**, jadi semua staff (admin, PIC branch, driver) nampak data yang sama.

## Apa yang berubah dari prototype

| | Prototype | App ini |
|---|---|---|
| Simpanan data | Claude artifact storage | SQLite di server (`data/fleet.db`) + 50 versi terakhir setiap data disimpan untuk rollback |
| Login admin | Password dalam kod HTML (sesiapa boleh nampak) | Password disemak di server, sesi guna cookie HttpOnly (12 jam) |
| Data admin sahaja | Disekat di browser sahaja | Server tolak simpan kenalan WhatsApp, fleet target & utilization jika bukan admin |
| Library (Chart.js, XLSX, PDF.js) | CDN | Dibundle dalam `public/vendor` — tak bergantung pada CDN |
| Telefon | Layout desktop sahaja | Layout mobile (menu ☰), boleh **install sebagai app** (PWA) di Android / iPhone |
| Backup | — | Butang **⬇ Download Backup** di Settings (admin) → fail JSON semua data |

## Jalankan

Perlu **Node.js 22.9 atau lebih baru**. Tiada `npm install` diperlukan (tiada dependency).

```bash
cp .env.example .env      # isi ADMIN_PASSWORD & SESSION_SECRET
npm start                 # http://localhost:3000
```

### Docker

```bash
docker build -t fleet-ops .
docker run -d -p 3000:3000 -v fleet-data:/data \
  -e ADMIN_PASSWORD='password-kuat' -e SESSION_SECRET='rentetan-rawak-panjang' \
  fleet-ops
```

Database disimpan dalam volume `/data` — backup folder/volume ini.

## Tetapan (environment variables)

| Nama | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port server |
| `ADMIN_PASSWORD` | `komatsu2026` | **Tukar sebelum guna sebenar** |
| `SESSION_SECRET` | rawak setiap restart | Set supaya admin tak ter-logout bila server restart |
| `DATA_DIR` | `./data` | Lokasi fail database |

Untuk guna di luar office, letak di belakang HTTPS (cth. Nginx / Caddy / Cloudflare Tunnel,
atau hosting macam Render / Railway / Fly.io dengan persistent disk). Service worker & install
app di telefon perlukan HTTPS.

## Install di telefon

Buka URL app dalam Chrome (Android) → menu ⋮ → **Install app / Add to Home screen**.
iPhone: Safari → Share → **Add to Home Screen**.

## API

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/storage/:key` | Baca data (`fleetComplianceRegister_v2`, `fleetTickets_v1`, `fleetHiringRecords_v1`, `fleetCostingData_v1`, `fleetUtilizationData_v1`, `fleetTargetConfig_v1`, `fleetContactsConfig_v1`) |
| `PUT` | `/api/storage/:key` | Simpan data `{ "value": "<json text>" }` |
| `POST` | `/api/login` / `/api/logout` | Login / logout admin |
| `GET` | `/api/session` | Role semasa |
| `GET` | `/api/export` | Backup semua data (admin) |

Request yang ubah data mesti hantar header `X-Requested-With: fleet-app` (perlindungan CSRF).

## Had yang masih ada

- Data setiap modul disimpan sebagai satu blok. Kalau dua orang simpan modul yang **sama** pada
  masa yang hampir sama, simpanan terakhir yang menang (sama macam prototype). Tekan 🔄 Refresh
  sebelum edit besar.
- Peranan **Branch** masih pilihan dropdown (bukan login), sama macam prototype.
- Notify WhatsApp buka `wa.me` (staff tekan Send sendiri) — belum guna WhatsApp Business API.
