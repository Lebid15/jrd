import fetch from 'node-fetch';
import { runBayiAlayatlScraper } from './scrapers.js';

export async function fetchZnetBalance(config) {
  const { base_url, kod, sifre } = config;
  const cleanUrl = (base_url || '').replace(/\/+$/, '');
  const url = `${cleanUrl}/servis/bakiye_kontrol.php?kod=${encodeURIComponent(kod)}&sifre=${encodeURIComponent(sifre)}`;
  const res = await fetch(url, { timeout: 15000 });
  const text = await res.text();
  // Response format: OK|{balance}|{debt}
  const parts = text.trim().split('|');
  if (parts[0] === 'OK' && parts[1]) {
    const balance = parseFloat(parts[1]) || 0;
    const debt = parseFloat(parts[2]) || 0;
    // Real balance = balance - debt
    return { balance, debt, net: balance - debt };
  }
  throw new Error(`Znet error: ${text}`);
}

export async function fetchBarakatBalance(config) {
  const { base_url, api_token } = config;
  const cleanUrl = (base_url || 'https://api.barakat-store.com').replace(/\/+$/, '');
  const url = `${cleanUrl}/client/api/profile`;
  const res = await fetch(url, {
    headers: { 'api-token': api_token },
    timeout: 15000
  });
  const data = await res.json();
  if (data.balance !== undefined) {
    return parseFloat(data.balance);
  }
  throw new Error(`Barakat error: ${JSON.stringify(data)}`);
}

export async function fetchMuratTemizBalance(config) {
  const { base_url, kod, sifre } = config;
  const cleanUrl = (base_url || '').replace(/\/+$/, '');
  const url = `${cleanUrl}/services/talimat_bakiye_takip.php?bayi_kodu=${encodeURIComponent(kod)}&sifre=${encodeURIComponent(sifre)}&islem=bakiyeoku`;
  const res = await fetch(url, { timeout: 15000 });
  const text = await res.text();
  // Response format: ok:balance:debt:status
  const parts = text.trim().split(':');
  if (parts[0].toLowerCase() === 'ok' && parts[1]) {
    const balance = parseFloat(parts[1]) || 0;
    const debt = parseFloat(parts[2]) || 0;
    return { balance, debt, net: balance - debt };
  }
  throw new Error(`Murat Temiz error: ${text}`);
}

export async function fetchSmmPanelBalance(config) {
  const cleanUrl = (config.base_url || '').replace(/\/+$/, '');
  const url = `${cleanUrl}/api/v2`;
  const body = new URLSearchParams({ key: config.api_token || '', action: 'balance' });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
    body: body.toString(),
    timeout: 15000,
  });
  const text = await res.text();
  // Guard against HTML responses (geo-block / wrong endpoint)
  if (text.trimStart().startsWith('<')) {
    throw new Error(`SMM Panel returned HTML instead of JSON (HTTP ${res.status}). Check the base URL.`);
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`SMM Panel bad response: ${text.slice(0, 100)}`); }
  if (data.status === 'success' || data.balance != null) {
    return { balance: parseFloat(data.balance) || 0, currency: data.currency || 'USD' };
  }
  throw new Error(`SMM Panel error: ${JSON.stringify(data)}`);
}

export async function fetchBalance(providerType, config, opts = {}) {
  switch (providerType) {
    case 'znet': {
      const result = await fetchZnetBalance(config);
      // Return full details for znet (balance, debt, net)
      return { value: result.net, details: result };
    }
    case 'barakat': {
      const val = await fetchBarakatBalance(config);
      return { value: val, details: { balance: val } };
    }
    case 'murat_temiz': {
      const result = await fetchMuratTemizBalance(config);
      return { value: result.net, details: result };
    }
    case 'smm_panel': {
      const result = await fetchSmmPanelBalance(config);
      // Balance is in USD — signal with currency field so the route saves to usd_amount
      return { value: result.balance, currency: 'USD', details: result };
    }
    case 'bayi_alayatl': {
      const result = await runBayiAlayatlScraper(config, { itemId: opts.itemId });
      // We want "Benim Alacağım" = نفس الرقم بإشارة معكوسة عن "Bayi Alacağı"
      const value = result.bayi_alacagi != null ? -result.bayi_alacagi : null;
      return { value, details: result };
    }
    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}
