#include <Arduino.h>
#include "config.h"
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <BlynkSimpleEsp32.h>
#include <Adafruit_Fingerprint.h>
#include "esp_camera.h"

WebServer server(80);
HardwareSerial mySerial(1);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);
SemaphoreHandle_t fpMutex = NULL;
TaskHandle_t fingerTaskHandle = NULL;
volatile bool enrolling = false;
volatile bool fingerprintReady = false;
volatile bool attendanceMode = true;
unsigned long lastWifiAttemptAt = 0;
unsigned long lastBlynkAttemptAt = 0;
unsigned long lastWifiLogAt = 0;
bool wifiWasConnected = false;

const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
const unsigned long BLYNK_RECONNECT_INTERVAL_MS = 7000;

void setOnboardLed(bool on) {
  digitalWrite(LED_ONBOARD, on ? LOW : HIGH);
}

void blinkOnboardLed(uint8_t count, uint16_t onMs = 120, uint16_t offMs = 120) {
  for (uint8_t i = 0; i < count; i++) {
    setOnboardLed(true);
    delay(onMs);
    setOnboardLed(false);
    delay(offMs);
  }
}

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

bool initFingerprint() {
  mySerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(FP_BAUD);
  if (finger.verifyPassword()) {
    Serial.printf("[FP] OK! Kapasitas: %d\n", finger.capacity);
    fingerprintReady = true;
    return true;
  }
  Serial.println("[FP] Sensor tidak ditemukan");
  fingerprintReady = false;
  return false;
}

String jsonEscape(const char *value) {
  String output = "";
  while (*value) {
    if (*value == '"' || *value == '\\') output += '\\';
    output += *value;
    value++;
  }
  return output;
}

void sendEventToBackend(const char *type, const char *status, const char *message, int fingerprintId = -1) {
  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/esp32/events";
  http.begin(url);
  http.setTimeout(800);
  http.addHeader("Content-Type", "application/json");

  String body = "{\"type\":\"";
  body += jsonEscape(type);
  body += "\",\"status\":\"";
  body += jsonEscape(status);
  body += "\",\"message\":\"";
  body += jsonEscape(message);
  body += "\"";
  if (fingerprintId > 0) {
    body += ",\"fingerprintId\":";
    body += fingerprintId;
  }
  body += "}";

  int code = http.POST(body);
  Serial.printf("[EVENT] HTTP %d %s\n", code, message);
  http.end();
}

int scanFP() {
  if (finger.getImage() != FINGERPRINT_OK) return -2;
  if (finger.image2Tz() != FINGERPRINT_OK) return -1;
  if (finger.fingerSearch() != FINGERPRINT_OK) return -1;
  return finger.fingerID;
}

bool deleteFP(int id) {
  return finger.deleteModel(id) == FINGERPRINT_OK;
}

bool failEnroll(uint8_t id, const char *message) {
  Serial.printf("[FP] %s\n", message);
  sendEventToBackend("enroll", "danger", message, id);
  return false;
}

bool enrollFPUnlocked(uint8_t id) {
  int p = -1;
  Serial.printf("[FP] Mulai enrollment ID %d\n", id);
  sendEventToBackend("enroll", "info", "Mulai enrollment sidik jari", id);

  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    delay(80);
  }
  if (finger.image2Tz(1) != FINGERPRINT_OK) return failEnroll(id, "Pembacaan sidik jari pertama gagal");

  Serial.println("[FP] Lepaskan jari");
  sendEventToBackend("enroll", "warning", "Lepaskan jari dari sensor", id);
  delay(1800);
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    delay(80);
  }

  Serial.println("[FP] Tempelkan jari yang sama");
  sendEventToBackend("enroll", "info", "Tempelkan jari yang sama", id);
  p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    delay(80);
  }
  if (finger.image2Tz(2) != FINGERPRINT_OK) return failEnroll(id, "Pembacaan sidik jari kedua gagal");
  if (finger.createModel() != FINGERPRINT_OK) return failEnroll(id, "Sidik jari pertama dan kedua tidak cocok");
  if (finger.storeModel(id) != FINGERPRINT_OK) return failEnroll(id, "Gagal menyimpan sidik jari ke sensor");

  Serial.printf("[FP] Enrollment ID %d berhasil\n", id);
  sendEventToBackend("enroll", "success", "Enrollment sidik jari berhasil", id);
  return true;
}

bool enrollFP(uint8_t id) {
  if (!fingerprintReady || !fpMutex) {
    return failEnroll(id, "Sensor fingerprint belum siap");
  }

  enrolling = true;
  if (xSemaphoreTake(fpMutex, pdMS_TO_TICKS(5000)) != pdTRUE) {
    enrolling = false;
    return failEnroll(id, "Sensor fingerprint sedang sibuk");
  }

  bool ok = enrollFPUnlocked(id);
  xSemaphoreGive(fpMutex);
  enrolling = false;
  return ok;
}

void sendScanToBackend(int fingerprintId) {
  sendEventToBackend("scan", "info", "Sidik jari terbaca oleh sensor", fingerprintId);

  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/esp32/scan";
  http.begin(url);
  http.setTimeout(1500);
  http.addHeader("Content-Type", "application/json");

  String body = "{\"fingerprintId\":";
  body += fingerprintId;
  body += "}";

  int code = http.POST(body);
  String response = http.getString();
  Serial.printf("[API] Scan %d -> HTTP %d %s\n", fingerprintId, code, response.c_str());
  http.end();
}

void fingerTask(void *parameter) {
  (void)parameter;

  for (;;) {
    if (fingerprintReady && attendanceMode && !enrolling && fpMutex && xSemaphoreTake(fpMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
      int fingerId = scanFP();
      xSemaphoreGive(fpMutex);

      if (fingerId > 0) {
        setOnboardLed(true);
        Serial.printf("[FP] Terdeteksi ID %d\n", fingerId);
        sendScanToBackend(fingerId);
        setOnboardLed(false);
        blinkOnboardLed(2, 70, 70);
        vTaskDelay(pdMS_TO_TICKS(1600));
      }
    }

    vTaskDelay(pdMS_TO_TICKS(80));
  }
}

String argOrDefault(const char *name, const char *fallback) {
  if (server.hasArg(name)) return server.arg(name);
  return String(fallback);
}

void handleBlynkUpdate() {
  server.sendHeader("Access-Control-Allow-Origin", "*");

  if (WiFi.status() != WL_CONNECTED) {
    server.send(503, "application/json", "{\"ok\":false,\"message\":\"ESP32 belum konek internet\"}");
    return;
  }

  if (!Blynk.connected()) {
    Blynk.connect(800);
  }

  if (!Blynk.connected()) {
    server.send(503, "application/json", "{\"ok\":false,\"message\":\"Blynk belum terkoneksi\"}");
    return;
  }

  String name = argOrDefault("name", "-");
  String id = argOrDefault("fingerprintId", "-");
  String status = argOrDefault("status", "-");
  String time = argOrDefault("time", "-");
  String total = argOrDefault("total", "0");
  String remaining = argOrDefault("remaining", "0");
  String ratio = argOrDefault("ratio", "0/0");
  String percent = argOrDefault("percent", "0");

  Blynk.virtualWrite(BLYNK_VPIN_NAMA, name);
  Blynk.virtualWrite(BLYNK_VPIN_ID, id);
  Blynk.virtualWrite(BLYNK_VPIN_STATUS, status);
  Blynk.virtualWrite(BLYNK_VPIN_JAM, time);
  Blynk.virtualWrite(BLYNK_VPIN_TOTAL, total);
  Blynk.virtualWrite(BLYNK_VPIN_SISA, remaining);
  Blynk.virtualWrite(BLYNK_VPIN_RASIO, ratio);
  Blynk.virtualWrite(BLYNK_VPIN_PERSEN, percent);

  Serial.printf("[BLYNK] %s ID %s %s %s%%\n", name.c_str(), id.c_str(), ratio.c_str(), percent.c_str());
  server.send(200, "application/json", "{\"ok\":true}");
}

void handleJpg() {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Camera capture failed");
    return;
  }

  uint8_t *jpgBuf = NULL;
  size_t jpgLen = 0;
  bool ok = frame2jpg(fb, 80, &jpgBuf, &jpgLen);
  esp_camera_fb_return(fb);

  if (!ok || !jpgBuf) {
    if (jpgBuf) free(jpgBuf);
    server.send(500, "text/plain", "JPEG convert failed");
    return;
  }

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.setContentLength(jpgLen);
  server.send(200, "image/jpeg", "");
  server.client().write(jpgBuf, jpgLen);
  free(jpgBuf);
}

void handleStream() {
  WiFiClient client = server.client();
  client.print("HTTP/1.1 200 OK\r\n");
  client.print("Access-Control-Allow-Origin: *\r\n");
  client.print("Content-Type: multipart/x-mixed-replace; boundary=frame\r\n");
  client.print("Cache-Control: no-cache\r\n");
  client.print("Connection: close\r\n\r\n");

  int frameCount = 0;
  while (client.connected() && frameCount < 40) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) break;

    uint8_t *jpgBuf = NULL;
    size_t jpgLen = 0;
    bool ok = frame2jpg(fb, 80, &jpgBuf, &jpgLen);
    esp_camera_fb_return(fb);

    if (!ok || !jpgBuf) {
      if (jpgBuf) free(jpgBuf);
      Serial.println("[CAM] Stream JPEG convert gagal");
      break;
    }

    client.print("--frame\r\n");
    client.print("Content-Type: image/jpeg\r\n");
    client.printf("Content-Length: %u\r\n\r\n", (unsigned int)jpgLen);
    client.write(jpgBuf, jpgLen);
    client.print("\r\n");
    free(jpgBuf);
    frameCount++;

    delay(120);
  }
}

void setupRoutes() {
  server.on("/", []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    String body = "{\"device\":\"esp32cam\",\"status\":\"ok\",\"version\":\"";
    body += APP_VERSION;
    body += "\",\"apIp\":\"";
    body += WiFi.softAPIP().toString();
    body += "\",\"staConnected\":";
    body += (WiFi.status() == WL_CONNECTED ? "true" : "false");
    body += ",\"staIp\":\"";
    body += (WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "");
    body += "\",\"blynkConnected\":";
    body += (Blynk.connected() ? "true" : "false");
    body += ",\"mode\":\"";
    body += (attendanceMode ? "attendance" : "register");
    body += "\"";
    body += "}";
    server.send(200, "application/json", body);
  });
  server.on("/mode", HTTP_GET, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    if (!server.hasArg("value")) {
      server.send(400, "application/json", "{\"ok\":false,\"message\":\"value wajib diisi\"}");
      return;
    }

    String value = server.arg("value");
    if (value == "attendance") {
      attendanceMode = true;
    } else if (value == "register") {
      attendanceMode = false;
    } else {
      server.send(400, "application/json", "{\"ok\":false,\"message\":\"mode harus attendance atau register\"}");
      return;
    }

    String body = "{\"ok\":true,\"mode\":\"";
    body += (attendanceMode ? "attendance" : "register");
    body += "\"}";
    server.send(200, "application/json", body);
    Serial.printf("[MODE] %s\n", attendanceMode ? "attendance" : "register");
  });
  server.on("/enroll", HTTP_GET, []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    if (!server.hasArg("id")) {
      server.send(400, "application/json", "{\"ok\":false,\"message\":\"id wajib diisi\"}");
      return;
    }

    int id = server.arg("id").toInt();
    if (id <= 0 || id > 255) {
      server.send(400, "application/json", "{\"ok\":false,\"message\":\"id harus 1-255\"}");
      return;
    }

    bool ok = enrollFP((uint8_t)id);
    server.send(ok ? 200 : 422, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false,\"message\":\"enrollment gagal\"}");
  });
  server.on("/jpg", HTTP_GET, handleJpg);
  server.on("/stream", HTTP_GET, handleStream);
  server.on("/blynk/update", HTTP_POST, handleBlynkUpdate);
  server.on("/blynk/update", HTTP_GET, handleBlynkUpdate);
  server.begin();
}

void connectWifi() {
  IPAddress apIP(AP_IP_OCTET_1, AP_IP_OCTET_2, AP_IP_OCTET_3, AP_IP_OCTET_4);
  IPAddress gateway(AP_IP_OCTET_1, AP_IP_OCTET_2, AP_IP_OCTET_3, AP_IP_OCTET_4);
  IPAddress subnet(255, 255, 255, 0);

  WiFi.mode(WIFI_AP_STA);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.softAPConfig(apIP, gateway, subnet);
  bool apOk = WiFi.softAP(AP_SSID, AP_PASSWORD);

  Serial.printf("[AP] %s %s\n", AP_SSID, apOk ? "aktif" : "gagal");
  Serial.printf("[AP] IP ESP32: %s\n", WiFi.softAPIP().toString().c_str());
  Serial.println("[AP] Set IP laptop manual ke 192.168.4.2, subnet 255.255.255.0");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptAt = millis();
  Serial.printf("[WiFi] Auto-connect ke %s berjalan non-blocking\n", WIFI_SSID);
  Serial.println("[WiFi] Jika hotspot belum aktif, sistem lokal tetap berjalan dan akan reconnect otomatis.");
}

void maintainWifiClient() {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const unsigned long now = millis();

  if (connected) {
    if (!wifiWasConnected) {
      Serial.printf("[WiFi] Terhubung. IP STA: %s\n", WiFi.localIP().toString().c_str());
    }
    wifiWasConnected = true;
    return;
  }

  if (wifiWasConnected) {
    Serial.println("[WiFi] Hotspot terputus. AP lokal tetap aktif, mencoba reconnect otomatis.");
    Blynk.disconnect();
  }
  wifiWasConnected = false;

  if (now - lastWifiLogAt >= 15000) {
    Serial.printf("[WiFi] Belum terkoneksi ke %s. Sistem lokal tetap aktif.\n", WIFI_SSID);
    lastWifiLogAt = now;
  }

  if (now - lastWifiAttemptAt >= WIFI_RECONNECT_INTERVAL_MS) {
    Serial.printf("[WiFi] Reconnect ke %s...\n", WIFI_SSID);
    WiFi.disconnect(false, false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    lastWifiAttemptAt = now;
  }
}

void maintainBlynk() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (Blynk.connected()) {
    Blynk.run();
    return;
  }

  const unsigned long now = millis();
  if (now - lastBlynkAttemptAt >= BLYNK_RECONNECT_INTERVAL_MS) {
    Serial.println("[BLYNK] Mencoba konek ulang...");
    Blynk.connect(800);
    lastBlynkAttemptAt = now;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_FLASH_PIN, OUTPUT);
  pinMode(LED_ONBOARD, OUTPUT);
  digitalWrite(LED_FLASH_PIN, LOW);
  setOnboardLed(false);
  blinkOnboardLed(3, 120, 120);
  fpMutex = xSemaphoreCreateMutex();

  connectWifi();
  initCamera();
  initFingerprint();
  setupRoutes();
  Blynk.config(BLYNK_AUTH_TOKEN);

  xTaskCreatePinnedToCore(
    fingerTask,
    "fingerTask",
    8192,
    NULL,
    1,
    &fingerTaskHandle,
    1
  );
}

void loop() {
  server.handleClient();
  maintainWifiClient();
  maintainBlynk();

  delay(80);
}
