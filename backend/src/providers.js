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
    case 'bayi_alayatl': {
      const result = await runBayiAlayatlScraper(config, { itemId: opts.itemId });
      // The value we care about is "Bayi Alacağı" (the net difference)
      return { value: result.bayi_alacagi, details: result };
    }
    default:
      throw new Error(`Unknown provider type: ${providerType}`);
  }
}
