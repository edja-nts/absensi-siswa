async function sendBlynkUpdate(payload, espIp) {
  if (!espIp) {
    return { skipped: true, reason: 'IP ESP32 belum diset.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  const body = new URLSearchParams({
    name: payload.name || '-',
    fingerprintId: String(payload.fingerprintId || '-'),
    status: payload.status || '-',
    time: payload.time || '-',
    total: String(payload.total ?? 0),
    remaining: String(payload.remaining ?? 0),
    ratio: payload.ratio || '0/0',
    percent: String(payload.percent ?? 0)
  });

  try {
    const response = await fetch(`http://${espIp}/blynk/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));

    return {
      skipped: false,
      ok: response.ok,
      status: response.status,
      data
    };
  } catch (error) {
    return {
      skipped: false,
      ok: false,
      error: error.name === 'AbortError' ? 'Timeout menghubungi ESP32.' : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendBlynkUpdate };
