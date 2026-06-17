const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const rootDir = path.join(__dirname, '..');
const dbPath = path.resolve(rootDir, process.env.DATABASE_PATH || 'data/absensi.sqlite');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(rootDir, 'data/schema.sql'), 'utf8');
db.exec(schema);

const defaults = [
  ['esp_ip', ''],
  ['wifi_ssid', ''],
  ['wifi_password', ''],
  ['firmware_url', 'https://github.com/edja-nts/absensi-siswa/releases/latest/download/firmware.bin']
];

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
defaults.forEach(([key, value]) => insertSetting.run(key, value));

module.exports = db;
