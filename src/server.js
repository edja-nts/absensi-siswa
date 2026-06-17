require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');
const { WebSocketServer, WebSocket } = require('ws');
const db = require('./db');
const { sendBlynkUpdate } = require('./blynk');
const packageInfo = require('../package.json');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const rootDir = path.join(__dirname, '..');
const uploadDir = path.join(rootDir, 'public', 'uploads');
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({ storage });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev', {
  skip: (req) => req.path === '/api/esp32/events' && req.method === 'GET'
}));
app.use(express.static(path.join(rootDir, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  }
}));

const classOptions = ['Autis', 'Tuna Rungu', 'Tuna Grahita', 'Tuna Daksa', 'Tuna Netra', 'Tuna Wicara', 'Lainnya'];
const espEvents = [];

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  let sent = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      sent += 1;
    }
  });
  return sent;
}

function addEspEvent({ type = 'info', message, fingerprintId = null, status = 'info' }) {
  const safeStatus = ['info', 'success', 'warning', 'danger'].includes(status) ? status : 'info';
  const event = {
    id: Date.now(),
    type,
    status: safeStatus,
    message: message || 'Event ESP32 diterima.',
    fingerprintId,
    createdAt: new Date().toISOString()
  };

  espEvents.unshift(event);
  if (espEvents.length > 40) espEvents.pop();
  const sent = broadcast('esp-event', event);
  console.log(`[WS] event ${event.type}/${event.status} -> ${sent} client(s): ${event.message}`);
  return event;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowTime() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function mapStudent(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nik: row.nik,
    className: row.class_name,
    fingerprintId: row.fingerprint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function dashboardStats(date = today()) {
  const totalStudents = db.prepare('SELECT COUNT(*) AS count FROM students').get().count;
  const present = db.prepare(
    "SELECT COUNT(DISTINCT student_id) AS count FROM attendances WHERE attendance_date = ? AND status = 'present' AND student_id IS NOT NULL"
  ).get(date).count;
  const rejected = db.prepare(
    "SELECT COUNT(*) AS count FROM attendances WHERE attendance_date = ? AND status = 'rejected'"
  ).get(date).count;
  const percent = totalStudents > 0 ? Math.round((present / totalStudents) * 100) : 0;

  return {
    date,
    totalStudents,
    present,
    remaining: Math.max(totalStudents - present, 0),
    rejected,
    ratio: `${present}/${totalStudents}`,
    percent
  };
}

function getSetting(key, fallback = '') {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || fallback;
}

async function notifyBlynkViaEsp32({ student, fingerprintId, stats }) {
  const espIp = getSetting('esp_ip');
  const result = await sendBlynkUpdate({
    name: student?.name || '-',
    fingerprintId,
    status: 'Hadir',
    time: nowTime(),
    ...stats
  }, espIp);

  addEspEvent({
    type: 'blynk',
    status: result.ok ? 'success' : 'warning',
    fingerprintId,
    message: result.ok
      ? `Data ${student?.name || `ID ${fingerprintId}`} terkirim ke Blynk.`
      : `Blynk belum terkirim: ${result.reason || result.error || result.data?.message || 'ESP32 tidak merespons.'}`
  });

  return result;
}

function listAttendances(date = today(), limit = 80) {
  return db.prepare(`
    SELECT a.*, s.name, s.nik, s.class_name
    FROM attendances a
    LEFT JOIN students s ON s.id = a.student_id
    WHERE a.attendance_date = ?
    ORDER BY a.tapped_at DESC
    LIMIT ?
  `).all(date, limit).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    fingerprintId: row.fingerprint_id,
    name: row.name || 'Tidak dikenal',
    nik: row.nik || '-',
    className: row.class_name || '-',
    status: row.status,
    attendanceDate: row.attendance_date,
    tappedAt: row.tapped_at,
    photoPath: row.photo_path,
    note: row.note
  }));
}

function recordAttendance({ fingerprintId, photoPath = null, note = null }) {
  const student = db.prepare('SELECT * FROM students WHERE fingerprint_id = ?').get(fingerprintId);
  const date = today();
  const existing = student
    ? db.prepare("SELECT id FROM attendances WHERE student_id = ? AND attendance_date = ? AND status = 'present'").get(student.id, date)
    : null;

  if (student && existing) {
    return {
      accepted: false,
      duplicate: true,
      attendance: null,
      student: mapStudent(student),
      stats: dashboardStats(date)
    };
  }

  const status = student ? 'present' : 'rejected';
  const result = db.prepare(`
    INSERT INTO attendances (student_id, fingerprint_id, status, attendance_date, photo_path, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(student ? student.id : null, fingerprintId, status, date, photoPath, note);

  const stats = dashboardStats(date);

  return {
    accepted: Boolean(student),
    duplicate: false,
    attendance: { id: result.lastInsertRowid, status, photoPath },
    student: mapStudent(student),
    stats
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'absensi-siswa', version: packageInfo.version, port: PORT });
});

app.get('/api/meta', (_req, res) => {
  res.json({
    classOptions,
    version: packageInfo.version,
    service: packageInfo.name
  });
});

wss.on('connection', (socket) => {
  console.log(`[WS] browser connected. clients=${wss.clients.size}`);
  socket.send(JSON.stringify({ type: 'esp-events:init', payload: espEvents }));
  socket.on('close', () => {
    console.log(`[WS] browser disconnected. clients=${wss.clients.size}`);
  });
});

app.get('/api/esp32/events', (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.json(espEvents);
});

app.post('/api/esp32/events', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const event = addEspEvent(req.body || {});
  res.status(201).json({ ok: true, event });
});

app.get('/api/dashboard', (req, res) => {
  const date = req.query.date || today();
  const rows = db.prepare(`
    SELECT attendance_date, SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present_count
    FROM attendances
    GROUP BY attendance_date
    ORDER BY attendance_date DESC
    LIMIT 7
  `).all().reverse();

  res.json({
    stats: dashboardStats(date),
    history: listAttendances(date),
    chart: rows
  });
});

app.get('/api/students', (_req, res) => {
  const students = db.prepare('SELECT * FROM students ORDER BY name ASC').all().map(mapStudent);
  res.json(students);
});

app.post('/api/students', (req, res) => {
  const { name, nik, className, fingerprintId } = req.body;
  if (!name || !className || fingerprintId === undefined) {
    return res.status(400).json({ message: 'Nama, kelas, dan ID fingerprint wajib diisi.' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO students (name, nik, class_name, fingerprint_id)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), nik?.trim() || null, className, Number(fingerprintId));

    res.status(201).json(mapStudent(db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid)));
  } catch (error) {
    res.status(409).json({ message: 'NIK atau ID fingerprint sudah digunakan.', detail: error.message });
  }
});

app.put('/api/students/:id', (req, res) => {
  const { name, nik, className, fingerprintId } = req.body;
  const id = Number(req.params.id);

  try {
    db.prepare(`
      UPDATE students
      SET name = ?, nik = ?, class_name = ?, fingerprint_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name.trim(), nik?.trim() || null, className, Number(fingerprintId), id);

    res.json(mapStudent(db.prepare('SELECT * FROM students WHERE id = ?').get(id)));
  } catch (error) {
    res.status(409).json({ message: 'Gagal memperbarui siswa.', detail: error.message });
  }
});

app.delete('/api/students/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id = ?').run(Number(req.params.id));
  res.status(204).end();
});

app.delete('/api/students', (_req, res) => {
  db.prepare('DELETE FROM students').run();
  res.status(204).end();
});

app.get('/api/attendances', (req, res) => {
  res.json(listAttendances(req.query.date || today(), Number(req.query.limit || 80)));
});

app.post('/api/attendances/scan', upload.single('photo'), (req, res) => {
  const fingerprintId = Number(req.body.fingerprintId || req.body.fingerprint_id);
  if (!fingerprintId) {
    return res.status(400).json({ message: 'fingerprintId wajib dikirim.' });
  }

  const photoPath = req.file ? `/uploads/${req.file.filename}` : req.body.photoPath || null;
  const result = recordAttendance({ fingerprintId, photoPath, note: req.body.note || null });
  addEspEvent({
    type: 'scan',
    status: result.accepted ? 'success' : result.duplicate ? 'warning' : 'danger',
    fingerprintId,
    message: result.duplicate
      ? `ID ${fingerprintId} sudah absen hari ini.`
      : result.accepted
        ? `Sidik jari ID ${fingerprintId} terbaca dan absen berhasil.`
        : `Sidik jari ID ${fingerprintId} terbaca, tetapi belum terdaftar.`
  });
  if (result.accepted) {
    notifyBlynkViaEsp32({
      student: result.student,
      fingerprintId,
      stats: result.stats
    });
  }
  res.status(result.accepted ? 201 : 202).json(result);
});

app.delete('/api/attendances', (req, res) => {
  const date = req.query.date || today();
  db.prepare('DELETE FROM attendances WHERE attendance_date = ?').run(date);
  res.status(204).end();
});

app.get('/api/settings', (_req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key ASC').all();
  res.json(Object.fromEntries(rows.map((row) => [row.key, row.value])));
});

app.put('/api/settings', (req, res) => {
  const update = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  Object.entries(req.body).forEach(([key, value]) => update.run(key, String(value ?? '')));
  res.json({ ok: true });
});

app.post('/api/esp32/enroll', (req, res) => {
  const { name, nik, className, fingerprintId } = req.body;
  if (!name || !className || !fingerprintId) {
    return res.status(400).json({ ok: false, message: 'Payload enrollment tidak lengkap.' });
  }

  try {
    const info = db.prepare(`
      INSERT INTO students (name, nik, class_name, fingerprint_id)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), nik?.trim() || null, className, Number(fingerprintId));

    res.status(201).json({ ok: true, student: mapStudent(db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid)) });
  } catch (error) {
    res.status(409).json({ ok: false, message: 'Enrollment gagal, ID fingerprint atau NIK sudah ada.' });
  }
});

app.post('/api/esp32/scan', (req, res) => {
  const fingerprintId = Number(req.body.fingerprintId || req.body.id);
  if (!fingerprintId) {
    return res.status(400).json({ ok: false, message: 'fingerprintId kosong.' });
  }

  const result = recordAttendance({ fingerprintId, note: 'Dikirim dari ESP32' });
  addEspEvent({
    type: 'scan',
    status: result.accepted ? 'success' : result.duplicate ? 'warning' : 'danger',
    fingerprintId,
    message: result.duplicate
      ? `ID ${fingerprintId} sudah absen hari ini.`
      : result.accepted
        ? `Sidik jari ID ${fingerprintId} terbaca dan absen berhasil.`
        : `Sidik jari ID ${fingerprintId} terbaca, tetapi belum terdaftar.`
  });
  if (result.accepted) {
    notifyBlynkViaEsp32({
      student: result.student,
      fingerprintId,
      stats: result.stats
    });
  }
  res.status(result.accepted ? 201 : 202).json({ ok: true, ...result });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(rootDir, 'public', 'index.html'));
});

httpServer.listen(PORT, () => {
  console.log(`Absensi siswa berjalan di http://localhost:${PORT}`);
});
