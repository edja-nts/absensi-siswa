const VPINS = {
  name: 'V0',
  id: 'V1',
  status: 'V2',
  time: 'V3',
  total: 'V4',
  percent: 'V6',
  ratio: 'V7',
  remaining: 'V8'
};

async function sendBlynkUpdate(payload) {
  if (process.env.BLYNK_ENABLED !== 'true' || !process.env.BLYNK_AUTH_TOKEN) {
    return { skipped: true };
  }

  const baseUrl = 'https://blynk.cloud/external/api/update';
  const token = process.env.BLYNK_AUTH_TOKEN;
  const entries = [
    [VPINS.name, payload.name || '-'],
    [VPINS.id, payload.fingerprintId || '-'],
    [VPINS.status, payload.status || '-'],
    [VPINS.time, payload.time || '-'],
    [VPINS.total, payload.total ?? 0],
    [VPINS.remaining, payload.remaining ?? 0],
    [VPINS.ratio, payload.ratio || '0/0'],
    [VPINS.percent, payload.percent ?? 0]
  ];

  await Promise.all(
    entries.map(([pin, value]) => {
      const url = `${baseUrl}?token=${encodeURIComponent(token)}&${pin}=${encodeURIComponent(value)}`;
      return fetch(url).catch((error) => ({ error: error.message }));
    })
  );

  return { skipped: false };
}

module.exports = { sendBlynkUpdate };
