PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  nik TEXT UNIQUE,
  class_name TEXT NOT NULL,
  fingerprint_id INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  fingerprint_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'rejected')),
  attendance_date TEXT NOT NULL,
  tapped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  photo_path TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attendances_date ON attendances(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendances_fingerprint ON attendances(fingerprint_id);
