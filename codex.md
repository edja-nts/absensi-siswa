# absensi-siswa
Deskripsi
Sistem absesnsi sederhana menggunakan fingerprint untuk mentriger absen masuk siswa
sistem ini memiliki backend, frontend (web base), dan modul esp32cam beserta sensor finger
flow absen
1. siswa tempel jari ke sensor FP
2. di halaman web muncul popup data siswa yg sudah terdaftar (Nama, NIK, Kelas, ID finger)
3. pada saat popup muncul juga stream kamera untuk d capture saat absen berhasil
4. data foto, dan data siswa yg berhasil absen disimpan, dan bisa dilihat di histori
5. Kirim data absen ke Blynk

flow enrollment
1. input data Nama, NIK, Kelas, dan ID FP
    Pilihan dropbox kelas
    Autis
    Tuna Rungu
    Tuna Grahita
    Tuna Daksa
    Tuna Netra
    Tuna Wicara
    Lainnya
2. tempel jari siswa
3. jika hasil pembacaan sensor valid simpan data siswa

flow menu setting
1. Setting ssid dan pwssword wifi esp32
2. update firmware esp32 via ota github (opsional)
3. menampilkan ip address esp32 setelah konek k hotspot, ip ini d pakai untuk streaming saat popu absen, dan juga d menu live cam di dashboard

Dashboard web
1. Menampilkan menu Daftar, Absen, Setting, Live Cam
   a. Tabel Daftar Siswa ada fitur Edit, Delete
   b. Ada tombol clear data siswa, dengan konfirmasi
2. Halaman depan dashboard menampilkan info absensi(jumlah siswa terdaftar, rasio absensi, persentasi absen, absen di tolak)
3. Menampilkan histori absen hari ini dengan menambahkan fitur clear histori
4. Menampilkan grafik persentasi absen harian


1. Spesifikasi hardware
    1. Menggunakan esp32cam
        konfigurasi
        #define LED_FLASH_PIN   4    // Flash LED ESP32-CAM
        #define LED_ONBOARD     33   // LED merah onboard (active LOW)

        // --- Kamera ---
        #define CAM_QUALITY     12   // 0-63, makin kecil makin bagus (lebih besar file)
        #define CAM_FRAMESIZE   FRAMESIZE_QVGA  // 320x240

        // ============================================================
        //   PIN KAMERA (AI Thinker ESP32-CAM)
        // ============================================================
        #define PWDN_GPIO_NUM   32
        #define RESET_GPIO_NUM  -1
        #define XCLK_GPIO_NUM    0
        #define SIOD_GPIO_NUM   26
        #define SIOC_GPIO_NUM   27
        #define Y9_GPIO_NUM     35
        #define Y8_GPIO_NUM     34
        #define Y7_GPIO_NUM     39
        #define Y6_GPIO_NUM     36
        #define Y5_GPIO_NUM     21
        #define Y4_GPIO_NUM     19
        #define Y3_GPIO_NUM     18
        #define Y2_GPIO_NUM      5
        #define VSYNC_GPIO_NUM  25
        #define HREF_GPIO_NUM   23
        #define PCLK_GPIO_NUM   22

        // ============================================================
        //   KAMERA
        // ============================================================
        bool initCamera() {
        camera_config_t cfg;
        memset(&cfg, 0, sizeof(cfg));

        cfg.ledc_channel = LEDC_CHANNEL_0;
        cfg.ledc_timer   = LEDC_TIMER_0;
        cfg.pin_d0 = Y2_GPIO_NUM; cfg.pin_d1 = Y3_GPIO_NUM;
        cfg.pin_d2 = Y4_GPIO_NUM; cfg.pin_d3 = Y5_GPIO_NUM;
        cfg.pin_d4 = Y6_GPIO_NUM; cfg.pin_d5 = Y7_GPIO_NUM;
        cfg.pin_d6 = Y8_GPIO_NUM; cfg.pin_d7 = Y9_GPIO_NUM;
        cfg.pin_xclk     = XCLK_GPIO_NUM;
        cfg.pin_pclk     = PCLK_GPIO_NUM;
        cfg.pin_vsync    = VSYNC_GPIO_NUM;
        cfg.pin_href     = HREF_GPIO_NUM;
        cfg.pin_sccb_sda = SIOD_GPIO_NUM;
        cfg.pin_sccb_scl = SIOC_GPIO_NUM;
        cfg.pin_pwdn     = PWDN_GPIO_NUM;
        cfg.pin_reset    = RESET_GPIO_NUM;
        cfg.xclk_freq_hz = 10000000;          // 10MHz — lebih stabil (dari kode kamu)
        cfg.pixel_format = PIXFORMAT_RGB565;  // RGB565 → convert ke JPEG (dari kode kamu)
        cfg.frame_size   = FRAMESIZE_QQVGA;  // 160x120 default, bisa diubah
        cfg.fb_count     = 1;
        cfg.fb_location  = CAMERA_FB_IN_DRAM;
        cfg.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;

        esp_err_t err = esp_camera_init(&cfg);
        if (err != ESP_OK) { Serial.printf("[CAM] Gagal: 0x%x\n", err); return false; }

        // Verifikasi sensor
        sensor_t* s = esp_camera_sensor_get();
        if (!s) { Serial.println("[CAM] Sensor get GAGAL!"); return false; }
        Serial.printf("[CAM] Sensor PID: 0x%x\n", s->id.PID);
        s->set_framesize(s, FRAMESIZE_QQVGA);
        delay(300);

        // Test frame + convert JPEG
        camera_fb_t* fb = esp_camera_fb_get();
        if (!fb) { Serial.println("[CAM] Frame test GAGAL!"); return false; }
        Serial.printf("[CAM] Frame OK: %d bytes, format: %d\n", fb->len, fb->format);
        uint8_t* jpg_buf = NULL; size_t jpg_len = 0;
        bool conv = frame2jpg(fb, 80, &jpg_buf, &jpg_len);
        esp_camera_fb_return(fb);
        if (!conv || !jpg_buf) { Serial.println("[CAM] JPEG convert GAGAL!"); if(jpg_buf) free(jpg_buf); return false; }
        Serial.printf("[CAM] JPEG convert OK: %d bytes\n", jpg_len);
        free(jpg_buf);

        Serial.println("[CAM] Siap!");
        return true;
        }
    2. sensor finger print
        koneksi finger
        #define FP_RX_PIN   3    
        #define FP_TX_PIN   12   
        #define FP_BAUD     57600

        HardwareSerial mySerial(1);
        Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

        // ============================================================
        //   FINGERPRINT
        // ============================================================
        bool initFingerprint() {
        mySerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
        finger.begin(FP_BAUD);
        if (finger.verifyPassword()) {
            Serial.printf("[FP] OK! Kapasitas: %d\n", finger.capacity);
            return true;
        }
        Serial.println("[FP] Sensor tidak ditemukan!");
        return false;
        }

        int scanFP() {
        if (finger.getImage() != FINGERPRINT_OK)      return -2;
        if (finger.image2Tz() != FINGERPRINT_OK)      return -1;
        if (finger.fingerSearch() != FINGERPRINT_OK)  return -1;
        return finger.fingerID;
        }

        bool deleteFP(int id) {
        return finger.deleteModel(id) == FINGERPRINT_OK;
        }


2. Spesifikasi Webserver
    1. Backend menggunakan nodejs port 8080
    2. Frontend menggunakan HTML dan CSS
    3. Database menggunakan SQLite
    
3. Repository
    Menggunakan Github pubkic repository
    https://github.com/edja-nts/absensi-siswa#

4. Konfigurasi Blynk
    #define BLYNK_TEMPLATE_ID "TMPL67t1bjQQr"
    #define BLYNK_TEMPLATE_NAME "Presensi SLB"
    // --- Blynk (notifikasi saja) ---
    #define BLYNK_AUTH_TOKEN      "RzElXtyz9bjqAcBDtpV5Ah9ABPDUnFJf" 
    #define BLYNK_VPIN_NAMA     V0
    #define BLYNK_VPIN_ID       V1
    #define BLYNK_VPIN_STATUS   V2
    #define BLYNK_VPIN_JAM      V3
    #define BLYNK_VPIN_TOTAL    V4
    #define BLYNK_VPIN_SISA     V8
    #define BLYNK_VPIN_RASIO    V7
    #define BLYNK_VPIN_PERSEN   V6

Saya sertakan template database di folder data, dan contoh program platformio yang sdh berhasil membaca sensor finger dan menampilkan live kamera