# Absensi Siswa

Sistem absensi sederhana untuk siswa berbasis web, fingerprint, ESP32-CAM, SQLite, dan notifikasi Blynk.

## Fitur

- Dashboard ringkas: total siswa, rasio absen, persentase hadir, absen ditolak.
- Daftar siswa dengan tambah, edit, delete, dan clear data siswa.
- Absensi dari ID fingerprint dengan popup data siswa dan preview live camera.
- Histori absensi hari ini dengan clear histori.
- Grafik persentase/jumlah absensi harian.
- Setting SSID, password WiFi, IP ESP32, dan URL firmware OTA.
- Endpoint khusus ESP32 untuk scan fingerprint dan enrollment.
- Contoh firmware PlatformIO untuk ESP32-CAM + sensor fingerprint.

## Struktur

```text
src/                  Backend Express + SQLite
public/               Frontend HTML, CSS, JavaScript
data/schema.sql       Schema SQLite
data/presensi_slb.sql Template database lama dari brief
firmware/esp32cam     Contoh program PlatformIO
```

## Menjalankan Web

Pastikan Node.js sudah tersedia.

```bash
npm install
cp .env.example .env
npm run dev
```

Buka:

```text
http://localhost:8080
```

Database SQLite akan dibuat otomatis di `data/absensi.sqlite`.

## Endpoint Penting

- `GET /api/dashboard`
- `GET /api/students`
- `POST /api/students`
- `PUT /api/students/:id`
- `DELETE /api/students/:id`
- `POST /api/attendances/scan`
- `DELETE /api/attendances`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/esp32/scan`
- `POST /api/esp32/enroll`

Contoh payload scan dari ESP32:

```json
{
  "fingerprintId": 21
}
```

## Firmware ESP32-CAM

Edit file `firmware/esp32cam/include/config.h`:

```cpp
#define WIFI_SSID "NAMA_WIFI"
#define WIFI_PASSWORD "PASSWORD_WIFI"
#define BACKEND_URL "http://IP_KOMPUTER:8080"
```

Lalu upload dengan PlatformIO dari folder `firmware/esp32cam`.

Endpoint kamera di ESP32:

- `http://IP_ESP32/stream`
- `http://IP_ESP32/jpg`
- `http://IP_ESP32/enroll?id=21`

Masukkan IP ESP32 di menu Setting web agar live camera tampil di dashboard dan popup absensi.

## Blynk

Token dan virtual pin mengikuti brief di `codex.md`. Untuk mengaktifkan kirim data dari backend:

```env
BLYNK_ENABLED=true
BLYNK_AUTH_TOKEN=token_blynk
```

Secara default Blynk dimatikan agar development lokal tidak langsung mengirim request eksternal.
