# Fleet Ops — Fleet Swis Group

Web app untuk sistem fleet: Dashboard, Driver & Requester (workshop ticket & job request),
Repair & Maintenance (compliance register road tax / inspection / insurance / JKKP / APAD),
Costing, Hiring Management, Utilization, New / Dispose dan Settings WhatsApp.

Dibina dari prototype `fleet_dashboard_workshop_ticket_updated_8.html`. Prototype itu
simpan data dalam storage artifact Claude; app ini simpan data dalam **database di
server** (Supabase Postgres di Vercel, atau SQLite bila run sendiri), jadi semua staff (admin, PIC branch, driver) nampak data yang sama.

## Apa yang berubah dari prototype

| | Prototype | App ini |
|---|---|---|
| Simpanan data | Claude artifact storage | Supabase Postgres (Vercel) atau SQLite (`data/fleet.db`, local/Docker) + 50 versi terakhir setiap data disimpan untuk rollback |
| Login admin | Password dalam kod HTML (sesiapa boleh nampak) | Password disemak di server, sesi guna cookie HttpOnly (12 jam) |
| Data admin sahaja | Disekat di browser sahaja | Server tolak simpan kenalan WhatsApp, fleet target & utilization jika bukan admin |
| Library (Chart.js, XLSX, PDF.js) | CDN | Dibundle dalam `public/vendor` — tak bergantung pada CDN |
| Telefon | Layout desktop sahaja | Layout mobile (menu ☰), boleh **install sebagai app** (PWA) di Android / iPhone |
| Backup | — | Butang **⬇ Download Backup** di Settings (admin) → fail JSON semua data |
| Bahasa | English sahaja (campur BM) | Butang **BM / EN** di atas — semua teks, popup & carta tukar terus; pilihan diingat (`public/i18n.js`) |
| Tema | Cerah sahaja | Butang **🌙 / ☀️** — mod gelap & cerah, ikut tetapan peranti pada kali pertama |

## Deploy — Vercel + Supabase

App ini di-host di **Vercel** (halaman dari `public/` + API serverless dalam `api/`) dan data
disimpan dalam **Supabase Postgres** (Vercel tak ada disk kekal, jadi SQLite tak boleh digunakan di sana).

1. **Supabase → SQL Editor → New query** → paste isi `supabase/schema.sql` → **Run**.
   (Selamat untuk run semula.)
2. **Supabase → Project Settings → API Keys** → salin **Project URL** dan
   **secret key** (`sb_secret_…`, atau `service_role` key versi lama). Jangan guna publishable/anon key.
3. **Vercel → Project → Settings → Environment Variables** (tanda Production + Preview):

   | Nama | Nilai |
   |---|---|
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | secret key dari langkah 2 |
   | `ADMIN_PASSWORD` | password admin baru |
   | `SESSION_SECRET` | rentetan rawak panjang (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |

4. **Vercel → Deployments → ⋯ → Redeploy** (env var baru hanya dibaca selepas deploy semula).
5. Buka `https://<app>.vercel.app/api/health` — mesti tunjuk `"ok":true,"storage":"supabase"`.
   Kalau ada yang belum diset, app akan tunjuk banner merah di atas skrin.

Secret key hanya ada di server Vercel — tak pernah dihantar ke browser. Jadual Supabase dikunci
dengan RLS supaya anon/publishable key tak boleh baca data.

## Jalankan (local / Docker / VPS)

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
| `DATA_DIR` | `./data` | Lokasi fail SQLite (bila Supabase tak diset) |
| `SUPABASE_URL` | — | Bila diset bersama `SUPABASE_SERVICE_ROLE_KEY`, data disimpan di Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Secret / service_role key (server sahaja) |

Di Vercel, `ADMIN_PASSWORD`, `SESSION_SECRET` dan Supabase **wajib** — tanpa itu login admin
dan simpanan data dimatikan (tiada password default di internet awam).

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
| `GET` | `/api/health` | Status konfigurasi server & storage |

Request yang ubah data mesti hantar header `X-Requested-With: fleet-app` (perlindungan CSRF).

## Had yang masih ada

- Data setiap modul disimpan sebagai satu blok. Kalau dua orang simpan modul yang **sama** pada
  masa yang hampir sama, simpanan terakhir yang menang (sama macam prototype). Tekan 🔄 Refresh
  sebelum edit besar.
- Peranan **Branch** masih pilihan dropdown (bukan login), sama macam prototype.
- Notify WhatsApp buka `wa.me` (staff tekan Send sendiri) — belum guna WhatsApp Business API.
