# Dokumentasi Modul Sistem Absensi Siswa

Dokumen ini menjelaskan struktur kode backend, firmware ESP32-CAM, dan cara penggunaan modul sistem absensi siswa berbasis fingerprint, kamera, SQLite, WebSocket, dan Blynk.

## Ringkasan Sistem

Sistem absensi terdiri dari dua bagian utama:

1. Backend web berbasis Node.js dan Express.
2. Firmware ESP32-CAM berbasis PlatformIO dan Arduino.

Backend bertugas menyimpan data siswa, histori absensi, foto absensi, dashboard, grafik, dan komunikasi realtime ke halaman web. ESP32-CAM bertugas membaca sensor fingerprint, menyediakan endpoint kamera, mengirim hasil scan ke backend, menjalankan mode daftar/absen, dan meneruskan data absensi ke Blynk.

## Struktur Folder Utama

```text
src/
  server.js        Backend Express, API, WebSocket, upload foto
  db.js            Koneksi SQLite dan inisialisasi schema
  blynk.js         Helper backend untuk mengirim data ke ESP32 agar diteruskan ke Blynk

public/
  index.html       Struktur halaman web
  app.js           Logic frontend, WebSocket, dashboard, enrollment, capture foto
  styles.css       Tampilan UI
  uploads/         Folder foto absensi hasil capture

data/
  schema.sql       Schema database SQLite
  absensi.sqlite   Database lokal, dibuat otomatis

firmware/esp32cam/
  src/main.cpp     Firmware utama ESP32-CAM
  include/config.h Konfigurasi WiFi, backend, Blynk, pin kamera, pin fingerprint
  platformio.ini   Konfigurasi build PlatformIO
```

## Backend

Backend dijalankan dari `src/server.js`. Server menggunakan Express, SQLite, Multer, WebSocket, dan static file untuk frontend.

### Tugas Backend

- Menyajikan halaman web dari folder `public`.
- Mengelola data siswa.
- Mencatat absensi berdasarkan ID fingerprint.
- Mencegah siswa yang sama absen dua kali pada tanggal yang sama.
- Menyimpan absensi ditolak jika fingerprint tidak terdaftar.
- Menyimpan foto absensi ke `public/uploads`.
- Mengambil snapshot dari ESP32-CAM melalui endpoint proxy.
- Menampilkan dashboard, grafik Senin sampai Sabtu, dan histori berdasarkan tanggal.
- Mengirim event realtime ke web melalui WebSocket `/ws`.
- Mengirim data absensi berhasil ke ESP32 untuk diteruskan ke Blynk.

### Database

Database diinisialisasi oleh `src/db.js` dari `data/schema.sql`.

Tabel utama:

- `students`: data siswa, NIK, kelas, dan ID fingerprint.
- `attendances`: histori absensi, status, tanggal, waktu, foto, dan catatan.
- `settings`: pengaturan sederhana seperti IP ESP32.

File database default:

```text
data/absensi.sqlite
```

### Endpoint Backend Penting

```text
GET  /api/health
GET  /api/meta
GET  /api/dashboard?date=YYYY-MM-DD

GET    /api/students
POST   /api/students
PUT    /api/students/:id
DELETE /api/students/:id
DELETE /api/students

GET    /api/attendances?date=YYYY-MM-DD
POST   /api/attendances/scan
POST   /api/attendances/:id/photo
DELETE /api/attendances?date=YYYY-MM-DD

GET /api/settings
PUT /api/settings

GET  /api/esp32/events
POST /api/esp32/events
GET  /api/esp32/snapshot
POST /api/esp32/scan
POST /api/esp32/enroll
```

### Alur Absensi di Backend

1. ESP32 membaca sidik jari.
2. ESP32 mengirim `fingerprintId` ke `POST /api/esp32/scan`.
3. Backend mencari siswa berdasarkan `fingerprint_id`.
4. Jika siswa ditemukan dan belum absen hari itu, backend membuat record `present`.
5. Jika siswa sudah absen, backend mengembalikan status duplicate.
6. Jika ID fingerprint tidak terdaftar, backend membuat record `rejected`.
7. Backend mengirim event realtime ke web.
8. Web menampilkan popup absensi dan countdown capture foto.
9. Web meminta snapshot ke `GET /api/esp32/snapshot`.
10. Foto disimpan ke record absensi melalui `POST /api/attendances/:id/photo`.
11. Jika absensi berhasil, backend mengirim data siswa dan statistik ke ESP32 untuk diteruskan ke Blynk.

### WebSocket Realtime

Backend membuka WebSocket di:

```text
/ws
```

Event yang dikirim ke web antara lain:

- `esp-events:init`: daftar event awal saat web baru tersambung.
- `esp-event`: event baru dari ESP32, seperti scan fingerprint, enrollment, atau status Blynk.

Frontend tetap memiliki fallback polling ke `/api/esp32/events` jika WebSocket terputus.

### Blynk dari Backend

Backend tidak langsung mengirim ke Blynk cloud. Backend mengirim data ke ESP32:

```text
http://IP_ESP32/blynk/update
```

Data yang dikirim:

- nama siswa
- ID fingerprint
- status
- waktu
- total siswa
- sisa siswa
- rasio absensi
- persentase

ESP32 kemudian menjalankan `Blynk.virtualWrite` ke virtual pin yang sudah diatur di firmware.

## Firmware ESP32-CAM

Firmware utama berada di:

```text
firmware/esp32cam/src/main.cpp
```

Konfigurasi berada di:

```text
firmware/esp32cam/include/config.h
```

### Tugas Firmware

- Membuat access point lokal ESP32.
- Menjalankan WiFi client ke hotspot HP `c30`.
- Auto reconnect WiFi tanpa mengunci sistem.
- Menyediakan endpoint status, mode, kamera, enrollment, dan Blynk.
- Inisialisasi kamera ESP32-CAM.
- Inisialisasi sensor fingerprint.
- Membaca fingerprint di FreeRTOS task terpisah.
- Mengirim event sensor ke backend.
- Mengirim scan fingerprint ke backend.
- Menyalakan LED onboard saat fingerprint terdeteksi.
- Menjalankan koneksi Blynk jika internet tersedia.

### Konfigurasi Firmware

File:

```text
firmware/esp32cam/include/config.h
```

Bagian penting:

```cpp
#define APP_VERSION "1.0.1"

#define WIFI_SSID "c30"
#define WIFI_PASSWORD "12345678"

#define AP_SSID "Absensi-SLB"
#define AP_PASSWORD "12345678"

#define BACKEND_URL "http://192.168.4.2:8080"
```

Skema IP yang dipakai:

```text
ESP32 AP  : 192.168.4.1
Laptop   : 192.168.4.2
Backend  : http://192.168.4.2:8080
```

Laptop perlu tersambung ke AP ESP32 dan memakai IP manual `192.168.4.2` agar ESP32 bisa mengirim data ke backend.

### Mode Firmware

ESP32 memiliki dua mode:

```text
attendance
register
```

Mode `attendance`:

- Fingerprint yang terdeteksi dikirim sebagai absensi.
- Dipakai saat menu Absen, Dashboard, Setting, atau Live Cam.

Mode `register`:

- Fingerprint task tidak mengirim scan absensi.
- Dipakai saat menu Daftar Siswa dan proses enrollment.
- Mencegah jari yang ditempel setelah enrollment masuk sebagai absen.

Endpoint mode:

```text
GET http://192.168.4.1/mode?value=attendance
GET http://192.168.4.1/mode?value=register
```

Frontend mengubah mode ini otomatis saat menu berpindah.

### Endpoint Firmware

```text
GET /                 Status ESP32, versi firmware, status WiFi, status Blynk, mode
GET /mode?value=...   Ubah mode attendance/register
GET /enroll?id=ID     Enrollment fingerprint ke sensor
GET /jpg              Snapshot kamera
GET /stream           Stream MJPEG terbatas
GET /blynk/update     Terima data Blynk dari backend
POST /blynk/update    Terima data Blynk dari backend
```

Contoh response `/`:

```json
{
  "device": "esp32cam",
  "status": "ok",
  "version": "1.0.1",
  "apIp": "192.168.4.1",
  "staConnected": true,
  "staIp": "192.168.x.x",
  "blynkConnected": true,
  "mode": "attendance"
}
```

### WiFi dan Blynk

ESP32 berjalan dalam mode `WIFI_AP_STA`:

- AP lokal tetap aktif untuk laptop dan web server lokal.
- STA client mencoba konek ke hotspot HP `c30`.
- Jika hotspot belum aktif, sistem tetap berjalan.
- Jika hotspot hidup kembali, ESP32 reconnect otomatis.
- Jika Blynk belum terhubung, ESP32 mencoba reconnect berkala.

Status di web:

- `ESP32 offline`: web tidak bisa mengakses ESP32.
- `Blynk offline`: ESP32 hidup, tetapi internet atau Blynk belum tersambung.
- `Blynk online`: ESP32 tersambung internet dan Blynk.

### Fingerprint Task

Pembacaan fingerprint dijalankan di task sendiri:

```cpp
xTaskCreatePinnedToCore(fingerTask, ...)
```

Tujuannya agar pembacaan sensor tidak mengganggu web server ESP32 dan kamera. Task hanya mengirim scan jika:

- sensor siap,
- tidak sedang enrollment,
- mode aktif adalah `attendance`.

### LED Indikator

LED onboard dipakai sebagai indikator:

- Blink saat ESP32 boot.
- Menyala ketika fingerprint terdeteksi.
- Blink pendek setelah scan terkirim.

## Cara Menjalankan Backend

1. Install dependency Node.js.

```bash
npm install
```

2. Siapkan file environment.

```bash
cp .env.example .env
```

3. Jalankan server.

```bash
npm run dev
```

4. Buka web.

```text
http://localhost:8080
```

Jika laptop memakai IP manual `192.168.4.2`, web juga bisa dibuka dari:

```text
http://192.168.4.2:8080
```

## Cara Upload Firmware

1. Buka folder firmware.

```bash
cd firmware/esp32cam
```

2. Build firmware.

```bash
pio run
```

3. Upload ke ESP32-CAM.

```bash
pio run -t upload
```

4. Buka serial monitor jika perlu debug.

```bash
pio device monitor
```

## Cara Pemakaian Sistem

### 1. Siapkan Jaringan

1. Nyalakan ESP32-CAM.
2. Hubungkan laptop ke WiFi AP ESP32:

```text
SSID     : Absensi-SLB
Password : 12345678
```

3. Set IP laptop manual:

```text
IP Address : 192.168.4.2
Subnet     : 255.255.255.0
Gateway    : 192.168.4.1
```

4. Jika ingin Blynk aktif, nyalakan hotspot HP:

```text
SSID     : c30
Password : 12345678
```

ESP32 tetap bisa dipakai untuk absensi lokal meskipun hotspot HP belum aktif. Yang terputus hanya koneksi internet/Blynk.

### 2. Setting IP ESP32 di Web

1. Buka menu Setting.
2. Isi IP ESP32:

```text
192.168.4.1
```

3. Klik Simpan Setting.

Versi firmware dan status Blynk akan tampil di kiri bawah sidebar.

### 3. Daftar Siswa dan Enrollment Fingerprint

1. Buka menu Daftar.
2. Isi nama siswa, NIK, kelas, dan ID finger.
3. Klik Enroll Sensor.
4. Ikuti instruksi:

```text
Tempelkan jari
Lepaskan jari
Tempelkan jari yang sama
```

5. Jika enrollment berhasil, tombol Simpan aktif.
6. Klik Simpan.

Catatan:

- Saat berada di menu Daftar, ESP32 otomatis masuk mode `register`.
- Sidik jari yang ditempel tidak akan dicatat sebagai absen.
- Tombol Simpan tetap disable sampai enrollment berhasil untuk ID finger tersebut.

### 4. Absensi Siswa

1. Buka menu Absen.
2. ESP32 otomatis masuk mode `attendance`.
3. Siswa menempelkan jari ke sensor.
4. Web menampilkan event scan realtime.
5. Jika ID terdaftar, popup data siswa muncul.
6. Web melakukan countdown capture foto.
7. Foto tersimpan ke histori absensi.
8. Data absensi dikirim ke Blynk jika ESP32 tersambung internet dan Blynk.

### 5. Melihat Dashboard

Menu Dashboard menampilkan:

- total siswa,
- rasio hadir,
- persentase hadir,
- jumlah absen ditolak,
- grafik Senin sampai Sabtu,
- histori absensi berdasarkan tanggal.

Gunakan filter tanggal untuk melihat histori pada hari tertentu.

### 6. Live Camera

1. Pastikan IP ESP32 sudah disimpan.
2. Buka menu Live Cam.
3. Web mengambil gambar periodik dari:

```text
http://192.168.4.1/jpg
```

Live cam memakai snapshot periodik agar tidak terlalu membebani loop ESP32.

## Alur Data Singkat

### Alur Enrollment

```text
Web menu Daftar
  -> set ESP32 mode register
  -> user klik Enroll Sensor
  -> web panggil ESP32 /enroll?id=...
  -> ESP32 enrollment ke sensor fingerprint
  -> ESP32 kirim event proses ke backend
  -> backend broadcast event ke web
  -> enrollment berhasil
  -> tombol Simpan aktif
  -> data siswa disimpan ke SQLite
```

### Alur Absensi

```text
Web menu Absen
  -> set ESP32 mode attendance
  -> siswa tempel jari
  -> ESP32 cari ID fingerprint
  -> ESP32 POST ke backend /api/esp32/scan
  -> backend validasi siswa dan duplicate
  -> backend simpan attendance
  -> backend broadcast event WebSocket
  -> web popup countdown capture foto
  -> backend ambil snapshot ESP32
  -> web upload foto ke attendance
  -> backend kirim data ke ESP32 /blynk/update
  -> ESP32 virtualWrite ke Blynk
```

## Troubleshooting

### Web menampilkan ESP32 offline

Periksa:

- laptop sudah tersambung ke AP `Absensi-SLB`,
- IP laptop sudah `192.168.4.2`,
- IP ESP32 di Setting web sudah `192.168.4.1`,
- ESP32 sudah menyala.

Tes dari browser:

```text
http://192.168.4.1/
```

### Blynk offline

ESP32 hidup, tetapi belum tersambung internet atau Blynk.

Periksa:

- hotspot HP `c30` sudah aktif,
- password hotspot benar,
- HP memiliki internet,
- token Blynk di `config.h` benar.

### Fingerprint terbaca tetapi tidak masuk absensi

Kemungkinan ESP32 sedang mode `register`.

Solusi:

- pindah ke menu Absen,
- atau panggil manual:

```text
http://192.168.4.1/mode?value=attendance
```

### Setelah enrollment, jari ditempel lagi tidak masuk absen

Ini perilaku yang benar saat masih di menu Daftar. Pindah ke menu Absen agar fingerprint dicatat sebagai absensi.

### Foto tidak muncul di histori

Periksa:

- IP ESP32 di Setting benar,
- endpoint snapshot bisa dibuka:

```text
http://192.168.4.1/jpg
```

- folder `public/uploads` dapat ditulis oleh server Node.js.

### HTTP -1 atau timeout dari ESP32

Biasanya ESP32 tidak bisa menghubungi backend.

Periksa:

- laptop IP `192.168.4.2`,
- backend berjalan di port `8080`,
- `BACKEND_URL` firmware adalah `http://192.168.4.2:8080`,
- firewall laptop tidak memblokir koneksi dari ESP32.

## Catatan Versioning dan Git

Versi aplikasi web dibaca dari `package.json`. Versi firmware dibaca dari `APP_VERSION` di `firmware/esp32cam/include/config.h`.

Mulai versi `1.0.1`, setiap bugfix atau fitur sebaiknya menaikkan versi:

- patch: bugfix kecil, contoh `1.0.1` ke `1.0.2`,
- minor: fitur baru, contoh `1.0.1` ke `1.1.0`,
- major: perubahan besar atau breaking change, contoh `1.1.0` ke `2.0.0`.

Perubahan bugfix atau fitur sebaiknya dibuat di branch terpisah lalu dicommit satu paket bersama bump versi.
