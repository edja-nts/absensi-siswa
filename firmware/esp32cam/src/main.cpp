#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <BlynkSimpleEsp32.h>
#include <Adafruit_Fingerprint.h>
#include "esp_camera.h"
#include "config.h"

WebServer server(80);
HardwareSerial mySerial(1);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

bool initCamera() {
  camera_config_t cfg;
  memset(&cfg, 0, sizeof(cfg));

  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer = LEDC_TIMER_0;
  cfg.pin_d0 = Y2_GPIO_NUM;
  cfg.pin_d1 = Y3_GPIO_NUM;
  cfg.pin_d2 = Y4_GPIO_NUM;
  cfg.pin_d3 = Y5_GPIO_NUM;
  cfg.pin_d4 = Y6_GPIO_NUM;
  cfg.pin_d5 = Y7_GPIO_NUM;
  cfg.pin_d6 = Y8_GPIO_NUM;
  cfg.pin_d7 = Y9_GPIO_NUM;
  cfg.pin_xclk = XCLK_GPIO_NUM;
  cfg.pin_pclk = PCLK_GPIO_NUM;
  cfg.pin_vsync = VSYNC_GPIO_NUM;
  cfg.pin_href = HREF_GPIO_NUM;
  cfg.pin_sccb_sda = SIOD_GPIO_NUM;
  cfg.pin_sccb_scl = SIOC_GPIO_NUM;
  cfg.pin_pwdn = PWDN_GPIO_NUM;
  cfg.pin_reset = RESET_GPIO_NUM;
  cfg.xclk_freq_hz = 10000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size = CAM_FRAMESIZE;
  cfg.jpeg_quality = CAM_QUALITY;
  cfg.fb_count = 1;
  cfg.fb_location = CAMERA_FB_IN_DRAM;
  cfg.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  esp_err_t err = esp_camera_init(&cfg);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Gagal: 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_framesize(s, CAM_FRAMESIZE);
  }

  Serial.println("[CAM] Siap");
  return true;
}

bool initFingerprint() {
  mySerial.begin(FP_BAUD, SERIAL_8N1, FP_RX_PIN, FP_TX_PIN);
  finger.begin(FP_BAUD);
  if (finger.verifyPassword()) {
    Serial.printf("[FP] OK! Kapasitas: %d\n", finger.capacity);
    return true;
  }
  Serial.println("[FP] Sensor tidak ditemukan");
  return false;
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

bool enrollFP(uint8_t id) {
  int p = -1;
  Serial.printf("[FP] Mulai enrollment ID %d\n", id);

  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    delay(80);
  }
  if (finger.image2Tz(1) != FINGERPRINT_OK) return false;

  Serial.println("[FP] Lepaskan jari");
  delay(1800);
  while (finger.getImage() != FINGERPRINT_NOFINGER) {
    delay(80);
  }

  Serial.println("[FP] Tempelkan jari yang sama");
  p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    delay(80);
  }
  if (finger.image2Tz(2) != FINGERPRINT_OK) return false;
  if (finger.createModel() != FINGERPRINT_OK) return false;
  if (finger.storeModel(id) != FINGERPRINT_OK) return false;

  Serial.printf("[FP] Enrollment ID %d berhasil\n", id);
  return true;
}

void sendScanToBackend(int fingerprintId) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(BACKEND_URL) + "/api/esp32/scan";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<128> doc;
  doc["fingerprintId"] = fingerprintId;
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  String response = http.getString();
  Serial.printf("[API] Scan %d -> HTTP %d %s\n", fingerprintId, code, response.c_str());
  http.end();
}

void handleJpg() {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Camera capture failed");
    return;
  }

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void handleStream() {
  WiFiClient client = server.client();
  String response = "HTTP/1.1 200 OK\r\n";
  response += "Access-Control-Allow-Origin: *\r\n";
  response += "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
  server.sendContent(response);

  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) break;

    server.sendContent("--frame\r\n");
    server.sendContent("Content-Type: image/jpeg\r\n\r\n");
    client.write(fb->buf, fb->len);
    server.sendContent("\r\n");
    esp_camera_fb_return(fb);
    delay(90);
  }
}

void setupRoutes() {
  server.on("/", []() {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.send(200, "application/json", "{\"device\":\"esp32cam\",\"status\":\"ok\"}");
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
  server.begin();
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WiFi] Menghubungkan ke %s", WIFI_SSID);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.printf("\n[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_FLASH_PIN, OUTPUT);
  pinMode(LED_ONBOARD, OUTPUT);
  digitalWrite(LED_FLASH_PIN, LOW);
  digitalWrite(LED_ONBOARD, HIGH);

  connectWifi();
  initCamera();
  initFingerprint();
  setupRoutes();
  Blynk.config(BLYNK_AUTH_TOKEN);
}

void loop() {
  server.handleClient();
  Blynk.run();

  int fingerId = scanFP();
  if (fingerId > 0) {
    digitalWrite(LED_ONBOARD, LOW);
    Serial.printf("[FP] Terdeteksi ID %d\n", fingerId);
    sendScanToBackend(fingerId);
    delay(1600);
    digitalWrite(LED_ONBOARD, HIGH);
  }

  delay(80);
}
