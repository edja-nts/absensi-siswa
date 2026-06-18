const state = {
  students: [],
  settings: {},
  dashboard: null,
  classOptions: [],
  espEvents: [],
  lastEventId: null,
  ws: null,
  wsReconnectTimer: null,
  fallbackTimer: null,
  cameraTimer: null,
  captureTimer: null,
  modalCloseTimer: null,
  captureAttendanceId: null,
  enrollment: {
    fingerprintId: null,
    status: 'idle',
    originalFingerprintId: null
  },
  version: '-',
  firmwareVersion: '-',
  selectedDate: ''
};

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function toast(message) {
  const el = qs('#toast');
  el.textContent = message;
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Terjadi kesalahan.' }));
    throw new Error(error.message || 'Terjadi kesalahan.');
  }

  if (response.status === 204) return null;
  return response.json();
}

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function formatDate() {
  const now = new Date();
  state.selectedDate = formatInputDate(now);
  qs('#todayLabel').textContent = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function formatInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatReadableDate(dateValue) {
  return new Date(`${dateValue}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

function setView(viewId) {
  qsa('.view').forEach((view) => view.classList.toggle('active', view.id === viewId));
  qsa('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewId));
  const title = qsa('.nav-item').find((item) => item.dataset.view === viewId)?.textContent || 'Dashboard';
  qs('#viewTitle').textContent = title;
  if (viewId === 'camera') {
    startLiveCamera();
  } else {
    stopLiveCamera();
  }
}

function fillClasses() {
  const select = qs('#className');
  select.innerHTML = state.classOptions.map((item) => `<option value="${item}">${item}</option>`).join('');
}

function renderStats() {
  const stats = state.dashboard?.stats || {};
  qs('#totalStudents').textContent = stats.totalStudents ?? 0;
  qs('#ratio').textContent = stats.ratio ?? '0/0';
  qs('#percent').textContent = `${stats.percent ?? 0}%`;
  qs('#rejected').textContent = stats.rejected ?? 0;
}

function renderChart() {
  const chart = qs('#dailyChart');
  const rows = state.dashboard?.chart || [];
  const totalStudents = state.dashboard?.stats?.totalStudents || 0;

  chart.innerHTML = rows.length
    ? `
      <div class="chart-y-title">Persentase</div>
      <div class="chart-y-axis">
        <span>100%</span>
        <span>75%</span>
        <span>50%</span>
        <span>25%</span>
        <span>0%</span>
      </div>
      <div class="chart-plot">
        ${rows.map((row) => {
      const count = row.present_count || 0;
      const percentValue = totalStudents > 0 ? Math.round((count / totalStudents) * 100) : 0;
      const height = percentValue > 0 ? Math.max(8, percentValue) : 0;
      const label = row.label || row.attendance_date.slice(5);
      return `
        <div class="bar">
          <div class="bar-track">
            <div class="bar-fill" style="height:${height}%" title="${label}: ${percentValue}% (${count} siswa)">
              <span>${percentValue}%</span>
            </div>
          </div>
          <strong>${label}</strong>
          <small>${count} siswa</small>
        </div>
      `;
    }).join('')}
      </div>
      <div class="chart-x-title">Hari / Jumlah Hadir</div>
    `
    : '<p class="muted">Belum ada data absensi.</p>';
}

function renderHistory() {
  const list = qs('#historyList');
  const rows = state.dashboard?.history || [];
  qs('#historyTitle').textContent = `Histori Absensi - ${formatReadableDate(state.selectedDate)}`;

  list.innerHTML = rows.length
    ? rows.map((item) => `
      <article class="history-item">
        ${item.photoPath
          ? `<img class="history-photo" src="${escapeHtml(item.photoPath)}" alt="Foto ${escapeHtml(item.name)}" />`
          : `<span class="avatar">${escapeHtml(initials(item.name))}</span>`}
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <div class="muted">${escapeHtml(item.className)} - ID ${escapeHtml(item.fingerprintId)}</div>
        </div>
        <span class="badge ${item.status === 'rejected' ? 'rejected' : ''}">${item.status === 'present' ? 'Hadir' : 'Ditolak'}</span>
      </article>
    `).join('')
    : '<p class="muted">Belum ada absensi hari ini.</p>';
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function eventStatusClass(status) {
  return ['success', 'warning', 'danger'].includes(status) ? status : 'info';
}

function setRealtimeStatus(connected) {
  const el = qs('#wsStatus');
  if (!el) return;
  el.textContent = connected ? 'Realtime on' : 'Realtime off';
  el.classList.toggle('offline', !connected);
}

function renderVersions() {
  qs('#webVersion').textContent = `Web v${state.version || '-'}`;
  qs('#firmwareVersion').textContent = `FW v${state.firmwareVersion || '-'}`;
  qs('#firmwareVersion').classList.toggle('offline', !state.firmwareVersion || state.firmwareVersion === '-');
}

async function refreshFirmwareVersion() {
  const ip = state.settings.esp_ip;
  state.firmwareVersion = '-';
  renderVersions();

  if (!ip) return;

  try {
    const response = await fetch(`http://${ip}/`, { cache: 'no-store' });
    const data = await response.json();
    state.firmwareVersion = data.version || '-';
  } catch (_error) {
    state.firmwareVersion = '-';
  }
  renderVersions();
}

function renderEspEvents() {
  const latest = state.espEvents[0];
  const list = qs('#espEventList');
  const monitor = qs('#fingerprintMonitor');
  const badge = qs('#fingerStatusBadge');

  if (!latest) {
    qs('#fingerStatusText').textContent = 'Menunggu sidik jari';
    qs('#fingerStatusDetail').textContent = 'Aktivitas sensor akan tampil di sini.';
    qs('#fingerStatusId').textContent = 'ID -';
    list.innerHTML = '<p class="muted">Belum ada aktivitas sensor.</p>';
    return;
  }

  const isFresh = Date.now() - new Date(latest.createdAt).getTime() < 7000;
  monitor.classList.toggle('active', isFresh);
  badge.className = `badge ${latest.status === 'danger' ? 'rejected' : ''}`;
  badge.textContent = latest.status === 'success'
    ? 'Berhasil'
    : latest.status === 'warning'
      ? 'Proses'
      : latest.status === 'danger'
        ? 'Ditolak'
        : 'Terbaca';

  qs('#fingerStatusText').textContent = latest.type === 'enroll' ? 'Enrollment fingerprint' : 'Scan fingerprint';
  qs('#fingerStatusDetail').textContent = latest.message;
  qs('#fingerStatusId').textContent = latest.fingerprintId ? `ID ${latest.fingerprintId}` : 'ID -';

  list.innerHTML = state.espEvents.length
    ? state.espEvents.map((event) => `
      <article class="event-item ${eventStatusClass(event.status)}">
        <span class="event-pulse"></span>
        <div>
          <strong>${escapeHtml(event.message)}</strong>
          <div class="muted">${escapeHtml(event.type)}${event.fingerprintId ? ` - ID ${escapeHtml(event.fingerprintId)}` : ''}</div>
        </div>
        <span class="event-time">${formatTime(event.createdAt)}</span>
      </article>
    `).join('')
    : '<p class="muted">Belum ada aktivitas sensor.</p>';
}

function currentFingerprintId() {
  return Number(qs('#fingerprintId')?.value || 0);
}

function enrollmentAllowsSave() {
  const id = qs('#studentId')?.value;
  const fingerprintId = currentFingerprintId();
  const unchangedExistingFinger = Boolean(id)
    && fingerprintId > 0
    && fingerprintId === state.enrollment.originalFingerprintId;

  return unchangedExistingFinger
    || (state.enrollment.status === 'success' && state.enrollment.fingerprintId === fingerprintId);
}

function setEnrollmentStatus(status, title, detail, fingerprintId = currentFingerprintId()) {
  const el = qs('#enrollmentStatus');
  if (!el) return;

  state.enrollment.status = status;
  state.enrollment.fingerprintId = fingerprintId || null;
  el.className = `enrollment-status ${status === 'idle' ? 'waiting' : status}`;
  el.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(detail)}</span>
  `;
  qs('#saveStudentBtn').disabled = !enrollmentAllowsSave();
}

function resetEnrollmentStatus() {
  state.enrollment.fingerprintId = null;
  state.enrollment.status = 'idle';
  state.enrollment.originalFingerprintId = null;
  setEnrollmentStatus(
    'idle',
    'Enrollment belum dilakukan',
    'Isi data siswa, masukkan ID finger, lalu tekan Enroll Sensor.'
  );
}

function updateSaveButtonState() {
  qs('#saveStudentBtn').disabled = !enrollmentAllowsSave();
}

function handleEnrollmentEvent(event) {
  if (event?.type !== 'enroll') return;
  const activeFingerId = currentFingerprintId();
  if (!event.fingerprintId || event.fingerprintId !== activeFingerId) return;

  if (event.status === 'success') {
    setEnrollmentStatus(
      'success',
      `Enrollment ID ${event.fingerprintId} berhasil`,
      'Data siswa sudah bisa disimpan.',
      event.fingerprintId
    );
    return;
  }

  if (event.status === 'danger') {
    setEnrollmentStatus(
      'danger',
      `Enrollment ID ${event.fingerprintId} gagal`,
      event.message,
      event.fingerprintId
    );
    return;
  }

  setEnrollmentStatus(
    'progress',
    `Enrollment ID ${event.fingerprintId} sedang diproses`,
    event.message,
    event.fingerprintId
  );
}

function mergeEspEvent(event) {
  if (!event?.id) return false;
  const isNew = !state.espEvents.some((item) => item.id === event.id);
  if (isNew) {
    state.espEvents = [event, ...state.espEvents].slice(0, 40);
    state.lastEventId = event.id;
    renderEspEvents();
    handleEnrollmentEvent(event);
    toast(event.message);
  }
  return isNew;
}

async function refreshDashboard() {
  state.dashboard = await api(`/api/dashboard?date=${encodeURIComponent(state.selectedDate)}`);
  renderStats();
  renderChart();
  renderHistory();
}

function normalizeScanResult(event) {
  return {
    accepted: Boolean(event.accepted),
    duplicate: Boolean(event.duplicate),
    attendance: event.attendance || null,
    student: event.student || null,
    stats: event.stats || null,
    fingerprintId: event.fingerprintId || null
  };
}

async function uploadAttendancePhoto(attendanceId, blob) {
  const formData = new FormData();
  formData.append('photo', blob, `absensi-${attendanceId}.jpg`);

  const response = await fetch(`/api/attendances/${attendanceId}/photo`, {
    method: 'POST',
    body: formData,
    cache: 'no-store'
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Gagal menyimpan foto.' }));
    throw new Error(error.message || 'Gagal menyimpan foto.');
  }

  return response.json();
}

async function captureAttendancePhoto(attendanceId) {
  const response = await fetch(`/api/esp32/snapshot?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Gagal mengambil foto dari ESP32-CAM.' }));
    throw new Error(error.message || 'Gagal mengambil foto dari ESP32-CAM.');
  }

  const blob = await response.blob();
  await uploadAttendancePhoto(attendanceId, blob);
  return URL.createObjectURL(blob);
}

function setCaptureStatus(count, text, visible = true) {
  const box = qs('#captureCountdown');
  if (!box) return;
  box.hidden = !visible;
  qs('#captureCount').textContent = count;
  qs('#captureText').textContent = text;
}

function clearCaptureTimer() {
  if (!state.captureTimer) return;
  window.clearInterval(state.captureTimer);
  state.captureTimer = null;
}

function clearModalCloseTimer() {
  if (!state.modalCloseTimer) return;
  window.clearTimeout(state.modalCloseTimer);
  state.modalCloseTimer = null;
}

async function addLocalEspEvent(event) {
  const result = await api('/api/esp32/events', {
    method: 'POST',
    body: JSON.stringify(event)
  });
  mergeEspEvent(result.event);
}

function connectEventSocket() {
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) return;

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  state.ws = socket;

  socket.addEventListener('open', () => {
    setRealtimeStatus(true);
    if (state.fallbackTimer) {
      window.clearInterval(state.fallbackTimer);
      state.fallbackTimer = null;
    }
  });

  socket.addEventListener('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message.data);
    } catch (_error) {
      return;
    }

    if (data.type === 'esp-events:init') {
      state.espEvents = data.payload || [];
      state.lastEventId = state.espEvents[0]?.id || null;
      renderEspEvents();
      return;
    }

    if (data.type === 'esp-event') {
      const isNew = mergeEspEvent(data.payload);
      if (isNew && data.payload?.type === 'scan') {
        if (data.payload.accepted && !data.payload.duplicate) {
          await showAttendanceCapture(normalizeScanResult(data.payload));
        }
        await refreshDashboard();
      }
    }
  });

  socket.addEventListener('close', () => {
    setRealtimeStatus(false);
    startEventFallback();
    if (state.wsReconnectTimer) window.clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = window.setTimeout(connectEventSocket, 1800);
  });

  socket.addEventListener('error', () => {
    setRealtimeStatus(false);
  });
}

async function pollEspEventsOnce() {
  try {
    const events = await api('/api/esp32/events');
    const latest = events[0];
    const hasNew = latest?.id && latest.id !== state.lastEventId;

    state.espEvents = events;
    state.lastEventId = latest?.id || null;
    renderEspEvents();

    if (hasNew) {
      toast(latest.message);
      if (latest.type === 'scan') {
        if (latest.accepted && !latest.duplicate) {
          await showAttendanceCapture(normalizeScanResult(latest));
        }
        await refreshDashboard();
      }
    }
  } catch (error) {
    console.warn(error.message);
  }
}

function startEventFallback() {
  if (state.fallbackTimer) return;
  state.fallbackTimer = window.setInterval(() => {
    if (state.ws?.readyState === WebSocket.OPEN) return;
    pollEspEventsOnce();
  }, 1500);
}

function renderStudents() {
  const tbody = qs('#studentRows');
  tbody.innerHTML = state.students.length
    ? state.students.map((student) => `
      <tr>
        <td><strong>${escapeHtml(student.name)}</strong></td>
        <td>${escapeHtml(student.nik || '-')}</td>
        <td>${escapeHtml(student.className)}</td>
        <td>${escapeHtml(student.fingerprintId)}</td>
        <td>
          <div class="row-actions">
            <button class="ghost" data-edit="${student.id}">Edit</button>
            <button class="danger" data-delete="${student.id}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('')
    : '<tr><td colspan="5">Belum ada data siswa.</td></tr>';
}

function resetStudentForm() {
  qs('#studentId').value = '';
  qs('#studentForm').reset();
  qs('#saveStudentBtn').textContent = 'Simpan';
  resetEnrollmentStatus();
}

function editStudent(id) {
  const student = state.students.find((item) => item.id === id);
  if (!student) return;
  qs('#studentId').value = student.id;
  qs('#name').value = student.name;
  qs('#nik').value = student.nik || '';
  qs('#className').value = student.className;
  qs('#fingerprintId').value = student.fingerprintId;
  qs('#saveStudentBtn').textContent = 'Update';
  state.enrollment.originalFingerprintId = Number(student.fingerprintId);
  setEnrollmentStatus(
    'success',
    `ID ${student.fingerprintId} sudah terdaftar`,
    'Data siswa lama bisa diperbarui. Jika ID finger diganti, lakukan enrollment ulang.',
    Number(student.fingerprintId)
  );
}

function updateEspStatus() {
  const ip = state.settings.esp_ip;
  qs('#espStatus').textContent = ip ? `ESP32: ${ip}` : 'ESP belum diset';
  qs('.status-dot').style.background = ip ? '#16a36f' : '#f2a51a';
}

function refreshCamera() {
  const ip = state.settings.esp_ip;
  const image = qs('#liveCam');
  const empty = qs('#cameraEmpty');

  if (!ip) {
    image.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  image.src = `http://${ip}/jpg?t=${Date.now()}`;
  image.style.display = 'block';
  empty.style.display = 'none';
}

function startLiveCamera() {
  refreshCamera();
  if (state.cameraTimer) window.clearInterval(state.cameraTimer);
  state.cameraTimer = window.setInterval(refreshCamera, 900);
}

function stopLiveCamera() {
  if (!state.cameraTimer) return;
  window.clearInterval(state.cameraTimer);
  state.cameraTimer = null;
}

function showAttendanceModal(result) {
  clearModalCloseTimer();
  const student = result.student || {};
  const accepted = result.accepted && !result.duplicate;
  qs('#modalName').textContent = student.name || (result.duplicate ? student.name : 'Fingerprint tidak dikenal');
  qs('#modalNik').textContent = student.nik || '-';
  qs('#modalClass').textContent = student.className || '-';
  qs('#modalFinger').textContent = student.fingerprintId || qs('#scanFingerprintId').value || '-';
  qs('#modalStatus').textContent = result.duplicate ? 'Sudah absen hari ini' : accepted ? 'Absen berhasil' : 'Absen ditolak';

  const ip = state.settings.esp_ip;
  const cam = qs('#modalCam');
  const empty = qs('#modalCamEmpty');
  if (ip) {
    cam.src = `http://${ip}/jpg?t=${Date.now()}`;
    cam.style.display = 'block';
    empty.style.display = 'none';
  } else {
    cam.style.display = 'none';
    empty.style.display = 'block';
  }

  qs('#attendanceModal').classList.add('show');
  qs('#attendanceModal').setAttribute('aria-hidden', 'false');
}

function closeAttendanceModal() {
  clearCaptureTimer();
  clearModalCloseTimer();
  state.captureAttendanceId = null;
  setCaptureStatus('', '', false);
  qs('#attendanceModal').classList.remove('show');
  qs('#attendanceModal').setAttribute('aria-hidden', 'true');
}

async function showAttendanceCapture(result) {
  const attendanceId = result.attendance?.id;
  if (attendanceId && state.captureAttendanceId === attendanceId) return;

  showAttendanceModal(result);
  clearCaptureTimer();

  if (!result.accepted || result.duplicate || !attendanceId) {
    setCaptureStatus('', '', false);
    state.modalCloseTimer = window.setTimeout(closeAttendanceModal, 2600);
    return;
  }

  state.captureAttendanceId = attendanceId;
  let seconds = 3;
  setCaptureStatus(seconds, 'Bersiap ambil foto');

  state.captureTimer = window.setInterval(async () => {
    seconds -= 1;
    if (seconds > 0) {
      setCaptureStatus(seconds, 'Tetap menghadap kamera');
      return;
    }

    clearCaptureTimer();
    setCaptureStatus('...', 'Mengambil foto');

    try {
      const photoUrl = await captureAttendancePhoto(attendanceId);
      const cam = qs('#modalCam');
      cam.src = photoUrl;
      cam.style.display = 'block';
      qs('#modalCamEmpty').style.display = 'none';
      setCaptureStatus('OK', 'Foto tersimpan');
      toast('Foto absensi tersimpan.');
      await refreshDashboard();
      state.captureAttendanceId = null;
      state.modalCloseTimer = window.setTimeout(closeAttendanceModal, 1600);
    } catch (error) {
      setCaptureStatus('!', error.message);
      state.captureAttendanceId = null;
      toast(error.message);
    }
  }, 1000);
}

async function loadAll() {
  const [meta, students, settings, dashboard, espEvents] = await Promise.all([
    api('/api/meta'),
    api('/api/students'),
    api('/api/settings'),
    api(`/api/dashboard?date=${encodeURIComponent(state.selectedDate)}`),
    api('/api/esp32/events')
  ]);

  state.classOptions = meta.classOptions;
  state.version = meta.version || '-';
  state.students = students;
  state.settings = settings;
  state.dashboard = dashboard;
  state.espEvents = espEvents;
  state.lastEventId = espEvents[0]?.id || null;

  fillClasses();
  renderStudents();
  renderStats();
  renderChart();
  renderHistory();
  renderEspEvents();
  updateEspStatus();
  renderVersions();
  refreshFirmwareVersion();
  qs('#dashboardDate').value = state.selectedDate;
}

function bindEvents() {
  qsa('.nav-item').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)));

  qs('#studentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!enrollmentAllowsSave()) {
      setEnrollmentStatus(
        'danger',
        'Simpan belum bisa dilakukan',
        'Enrollment fingerprint harus berhasil lebih dulu untuk ID finger ini.'
      );
      return;
    }

    const id = qs('#studentId').value;
    const payload = {
      name: qs('#name').value,
      nik: qs('#nik').value,
      className: qs('#className').value,
      fingerprintId: Number(qs('#fingerprintId').value)
    };

    await api(id ? `/api/students/${id}` : '/api/students', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });
    toast(id ? 'Data siswa diperbarui.' : 'Siswa baru disimpan.');
    resetStudentForm();
    state.students = await api('/api/students');
    state.dashboard = await api('/api/dashboard');
    renderStudents();
    renderStats();
  });

  qs('#studentRows').addEventListener('click', async (event) => {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    if (editId) editStudent(Number(editId));
    if (deleteId && confirm('Hapus siswa ini?')) {
      await api(`/api/students/${deleteId}`, { method: 'DELETE' });
      toast('Data siswa dihapus.');
      state.students = await api('/api/students');
      state.dashboard = await api('/api/dashboard');
      renderStudents();
      renderStats();
    }
  });

  qs('#resetFormBtn').addEventListener('click', resetStudentForm);

  qs('#dashboardDate').addEventListener('change', async (event) => {
    state.selectedDate = event.target.value || formatInputDate(new Date());
    await refreshDashboard();
  });

  qs('#fingerprintId').addEventListener('input', () => {
    const id = qs('#studentId').value;
    const fingerprintId = currentFingerprintId();
    if (id && fingerprintId === state.enrollment.originalFingerprintId) {
      setEnrollmentStatus(
        'success',
        `ID ${fingerprintId} sudah terdaftar`,
        'Data siswa lama bisa diperbarui. Jika ID finger diganti, lakukan enrollment ulang.',
        fingerprintId
      );
      return;
    }

    setEnrollmentStatus(
      'idle',
      'Enrollment belum dilakukan',
      'ID finger berubah, lakukan enrollment sensor sebelum menyimpan.',
      fingerprintId
    );
  });

  qs('#enrollSensorBtn').addEventListener('click', async () => {
    const ip = state.settings.esp_ip;
    const fingerprintId = Number(qs('#fingerprintId').value);
    if (!ip) {
      toast('Isi IP ESP32 di menu Setting terlebih dulu.');
      return;
    }
    if (!fingerprintId) {
      toast('Isi ID Finger terlebih dulu.');
      return;
    }
    await addLocalEspEvent({
      type: 'enroll',
      status: 'info',
      fingerprintId,
      message: 'Mulai enrollment. Tempelkan jari ke sensor.'
    });
    setEnrollmentStatus(
      'progress',
      `Enrollment ID ${fingerprintId} sedang diproses`,
      'Tempelkan jari ke sensor dan ikuti instruksi di panel Sensor Fingerprint.',
      fingerprintId
    );
    toast('Lihat panel Sensor Fingerprint untuk instruksi.');

    try {
      const response = await fetch(`http://${ip}/enroll?id=${fingerprintId}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) throw new Error(result.message || 'Enrollment sensor gagal.');
      setEnrollmentStatus(
        'success',
        `Enrollment ID ${fingerprintId} berhasil`,
        'Data siswa sudah bisa disimpan.',
        fingerprintId
      );
      toast('Enrollment sensor berhasil.');
    } catch (error) {
      await addLocalEspEvent({
        type: 'enroll',
        status: 'danger',
        fingerprintId,
        message: error.message
      });
      toast(error.message);
    }
  });

  qs('#clearStudentsBtn').addEventListener('click', async () => {
    if (!confirm('Hapus semua data siswa? Histori yang terkait akan kehilangan relasi siswa.')) return;
    await api('/api/students', { method: 'DELETE' });
    toast('Semua data siswa dihapus.');
    state.students = await api('/api/students');
    state.dashboard = await api('/api/dashboard');
    renderStudents();
    renderStats();
  });

  qs('#clearHistoryBtn').addEventListener('click', async () => {
    const dateLabel = formatReadableDate(state.selectedDate);
    const answer = prompt(`Ketik HAPUS untuk clear histori absensi ${dateLabel}.`);
    if (answer !== 'HAPUS') {
      toast('Clear histori dibatalkan.');
      return;
    }
    await api(`/api/attendances?date=${encodeURIComponent(state.selectedDate)}`, { method: 'DELETE' });
    toast('Histori hari ini dibersihkan.');
    await refreshDashboard();
  });

  qs('#scanForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api('/api/attendances/scan', {
      method: 'POST',
      body: JSON.stringify({ fingerprintId: Number(qs('#scanFingerprintId').value) })
    });
    await showAttendanceCapture(result);
    await refreshDashboard();
  });

  qs('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      esp_ip: qs('#esp_ip').value
    };
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    state.settings = await api('/api/settings');
    toast('Setting disimpan.');
    updateEspStatus();
    refreshCamera();
    refreshFirmwareVersion();
  });

  qs('#reloadCamBtn').addEventListener('click', refreshCamera);

  qs('#closeModalBtn').addEventListener('click', () => {
    closeAttendanceModal();
  });
}

async function init() {
  formatDate();
  setRealtimeStatus(false);
  bindEvents();
  await loadAll();
  connectEventSocket();
  ['esp_ip'].forEach((key) => {
    qs(`#${key}`).value = state.settings[key] || '';
  });
}

init().catch((error) => toast(error.message));
