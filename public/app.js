const state = {
  students: [],
  settings: {},
  dashboard: null,
  classOptions: [],
  espEvents: [],
  lastEventId: null,
  ws: null,
  wsReconnectTimer: null,
  fallbackTimer: null
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
  qs('#todayLabel').textContent = new Date().toLocaleDateString('id-ID', {
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
  if (viewId === 'camera') refreshCamera();
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
  const max = Math.max(1, ...rows.map((row) => row.present_count || 0));

  chart.innerHTML = rows.length
    ? rows.map((row) => {
      const height = Math.max(8, ((row.present_count || 0) / max) * 100);
      const label = row.attendance_date.slice(5);
      return `
        <div class="bar">
          <div class="bar-fill" style="height:${height}%"></div>
          <span>${label}<br>${row.present_count || 0}</span>
        </div>
      `;
    }).join('')
    : '<p class="muted">Belum ada data absensi.</p>';
}

function renderHistory() {
  const list = qs('#historyList');
  const rows = state.dashboard?.history || [];

  list.innerHTML = rows.length
    ? rows.map((item) => `
      <article class="history-item">
        <span class="avatar">${escapeHtml(initials(item.name))}</span>
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

function mergeEspEvent(event) {
  if (!event?.id) return false;
  const isNew = !state.espEvents.some((item) => item.id === event.id);
  if (isNew) {
    state.espEvents = [event, ...state.espEvents].slice(0, 40);
    state.lastEventId = event.id;
    renderEspEvents();
    toast(event.message);
  }
  return isNew;
}

async function refreshDashboard() {
  state.dashboard = await api('/api/dashboard');
  renderStats();
  renderChart();
  renderHistory();
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
      if (latest.type === 'scan') await refreshDashboard();
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

  image.src = `http://${ip}/stream?t=${Date.now()}`;
  image.style.display = 'block';
  empty.style.display = 'none';
}

function showAttendanceModal(result) {
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
    cam.src = `http://${ip}/stream?t=${Date.now()}`;
    cam.style.display = 'block';
    empty.style.display = 'none';
  } else {
    cam.style.display = 'none';
    empty.style.display = 'block';
  }

  qs('#attendanceModal').classList.add('show');
  qs('#attendanceModal').setAttribute('aria-hidden', 'false');
}

async function loadAll() {
  const [meta, students, settings, dashboard, espEvents] = await Promise.all([
    api('/api/meta'),
    api('/api/students'),
    api('/api/settings'),
    api('/api/dashboard'),
    api('/api/esp32/events')
  ]);

  state.classOptions = meta.classOptions;
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
}

function bindEvents() {
  qsa('.nav-item').forEach((item) => item.addEventListener('click', () => setView(item.dataset.view)));

  qs('#studentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
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
    toast('Lihat panel Sensor Fingerprint untuk instruksi.');

    try {
      const response = await fetch(`http://${ip}/enroll?id=${fingerprintId}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({ ok: false }));
      if (!response.ok || !result.ok) throw new Error(result.message || 'Enrollment sensor gagal.');
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
    if (!confirm('Clear histori absensi hari ini?')) return;
    await api('/api/attendances', { method: 'DELETE' });
    toast('Histori hari ini dibersihkan.');
    state.dashboard = await api('/api/dashboard');
    renderStats();
    renderChart();
    renderHistory();
  });

  qs('#scanForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await api('/api/attendances/scan', {
      method: 'POST',
      body: JSON.stringify({ fingerprintId: Number(qs('#scanFingerprintId').value) })
    });
    showAttendanceModal(result);
    state.dashboard = await api('/api/dashboard');
    renderStats();
    renderChart();
    renderHistory();
  });

  qs('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      wifi_ssid: qs('#wifi_ssid').value,
      wifi_password: qs('#wifi_password').value,
      esp_ip: qs('#esp_ip').value,
      firmware_url: qs('#firmware_url').value
    };
    await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    state.settings = await api('/api/settings');
    toast('Setting disimpan.');
    updateEspStatus();
    refreshCamera();
  });

  qs('#reloadCamBtn').addEventListener('click', refreshCamera);

  qs('#closeModalBtn').addEventListener('click', () => {
    qs('#attendanceModal').classList.remove('show');
    qs('#attendanceModal').setAttribute('aria-hidden', 'true');
  });
}

async function init() {
  formatDate();
  setRealtimeStatus(false);
  bindEvents();
  await loadAll();
  connectEventSocket();
  ['wifi_ssid', 'wifi_password', 'esp_ip', 'firmware_url'].forEach((key) => {
    qs(`#${key}`).value = state.settings[key] || '';
  });
}

init().catch((error) => toast(error.message));
