// script.js — uses ExchangeRate-API v6 (inserted key) with fallback & manual rate
document.addEventListener('DOMContentLoaded', () => {
  // NOTE: keep this root as the key-host portion (no /latest/... appended)
  const API_BASE = 'https://v6.exchangerate-api.com/v6/6b74612b6a28f7f59732e515';

  const amountEl = document.getElementById('amount');
  const fromEl = document.getElementById('fromCurrency');
  const toEl = document.getElementById('toCurrency');
  const convertBtn = document.getElementById('convertBtn');
  const swapBtn = document.getElementById('swapBtn');
  const resultEl = document.getElementById('result');
  const metaEl = document.getElementById('meta');
  const errorEl = document.getElementById('error');
  const manualRateEl = document.getElementById('manualRate');
  const applyManualBtn = document.getElementById('applyManual');
  const testApiBtn = document.getElementById('testApi');

  const SYMBOLS_CACHE_KEY = 'er_symbols_v1';

  const FALLBACK_SYMBOLS = {
    "USD": { description: "United States Dollar" },
    "EUR": { description: "Euro" },
    "INR": { description: "Indian Rupee" },
    "GBP": { description: "British Pound" },
    "JPY": { description: "Japanese Yen" },
    "AUD": { description: "Australian Dollar" },
    "CAD": { description: "Canadian Dollar" },
    "CNY": { description: "Chinese Yuan" }
  };

  function log(...args){ console.log('[CC]', ...args); }
  function fmt(n){ return Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
  function showError(msg){ errorEl.textContent = msg; }
  function clearError(){ errorEl.textContent = ''; }

  // fetch helper with timeout
  async function fetchWithTimeout(url, opts = {}, ms = 9000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  // populate <select>s
  function populateSymbols(symbolsObj){
    fromEl.innerHTML = '';
    toEl.innerHTML = '';

    const placeholderFrom = document.createElement('option');
    placeholderFrom.value = '';
    placeholderFrom.disabled = true;
    placeholderFrom.textContent = 'Select';
    fromEl.appendChild(placeholderFrom);

    const placeholderTo = placeholderFrom.cloneNode(true);
    toEl.appendChild(placeholderTo);

    Object.keys(symbolsObj).sort().forEach(code => {
      const desc = (symbolsObj[code] && (symbolsObj[code].description || symbolsObj[code].name)) || code;
      const o = document.createElement('option');
      o.value = code;
      o.textContent = `${code} — ${desc}`;
      fromEl.appendChild(o);
      toEl.appendChild(o.cloneNode(true));
    });

    // set sensible defaults if available
    if (!fromEl.value) {
      const usdOption = Array.from(fromEl.options).find(o => o.value === 'USD');
      fromEl.value = usdOption ? 'USD' : fromEl.options[1] ? fromEl.options[1].value : '';
    }
    if (!toEl.value) {
      const inrOption = Array.from(toEl.options).find(o => o.value === 'INR');
      toEl.value = inrOption ? 'INR' : toEl.options[1] ? toEl.options[1].value : '';
    }
  }

  // try cache first, then network
  async function loadSymbols() {
    try {
      const cached = localStorage.getItem(SYMBOLS_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Object.keys(parsed).length) {
          populateSymbols(parsed);
          // refresh in background
          fetchSymbolsAndCache().catch(e => log('background refresh failed', e));
          return;
        }
      }
    } catch (e) {
      log('cache parse error', e);
    }
    await fetchSymbolsAndCache();
  }

  // ExchangeRate-API v6: /codes -> supported_codes (array of [code, name])
  async function fetchSymbolsAndCache() {
    const url = `${API_BASE}/codes`;
    log('fetching symbols from', url);
    try {
      const res = await fetchWithTimeout(url, {}, 9000);
      log('symbols status', res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      // Expecting { result: "success", supported_codes: [ ["USD", "United States Dollar"], ... ] }
      const codes = data.supported_codes || data.supportedCodes || data.supportedCodes;
      if (Array.isArray(codes) && codes.length) {
        const obj = {};
        codes.forEach(item => {
          if (Array.isArray(item) && item.length >= 2) obj[item[0]] = { description: item[1] };
          else if (item && item.code) obj[item.code] = { description: item.name || item.description || item.code };
        });
        if (Object.keys(obj).length) {
          localStorage.setItem(SYMBOLS_CACHE_KEY, JSON.stringify(obj));
          populateSymbols(obj);
          clearError();
          log('symbols loaded from API, count=', Object.keys(obj).length);
          return;
        }
      }

      log('symbols response shape unexpected', data);
      populateSymbols(FALLBACK_SYMBOLS);
      showError('Failed to load currencies (API unexpected). Using fallback list.');
    } catch (err) {
      log('fetchSymbolsAndCache error:', err && err.message ? err.message : err);
      populateSymbols(FALLBACK_SYMBOLS);
      const message = (err && err.name === 'AbortError') ? 'Network timeout while loading currencies.' :
                      (err && err.message && err.message.includes('Failed to fetch')) ? 'Network fetch failed (CORS or offline).' :
                      'Unable to load currencies from the network.';
      showError(message + ' Using fallback list.');
    }
  }

  // Convert: use ExchangeRate-API latest endpoint: /latest/{base}
  async function convert(useManual = false, manualRate = null) {
    clearError();
    const amount = Number(amountEl.value);
    const from = fromEl.value;
    const to = toEl.value;
    if (!isFinite(amount) || amount < 0) { showError('Enter a valid amount (>= 0).'); return; }
    if (!from || !to) { showError('Select both currencies.'); return; }

    resultEl.innerHTML = `<div class="muted">Converting…</div>`;
    metaEl.textContent = '';

    // manual override
    if (useManual && manualRate !== null) {
      const converted = amount * Number(manualRate);
      resultEl.innerHTML = `<div class="value">${fmt(amount)} ${from} → ${fmt(converted)} ${to}</div>`;
      metaEl.textContent = `Manual rate used: 1 ${from} = ${fmt(manualRate)} ${to}`;
      return;
    }

    const url = `${API_BASE}/latest/${encodeURIComponent(from)}`;
    log('convert url', url);
    try {
      const res = await fetchWithTimeout(url, {}, 9000);
      log('convert status', res.status);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      log('convert response', data);
      const rates = data && (data.conversion_rates || data.conversionRates || data.rates);
      const rate = rates && rates[to];
      if ((rate === undefined || rate === null) && rate !== 0) throw new Error('Rate missing in response');
      const converted = amount * rate;
      resultEl.innerHTML = `<div class="value">${fmt(amount)} ${from} → ${fmt(converted)} ${to}</div>`;
      const updated = data && (data.time_last_update_utc || data.time_next_update_utc || data.time_last_update_unix) || '';
      metaEl.textContent = `1 ${from} = ${fmt(rate)} ${to}` + (updated ? ` (Updated: ${updated})` : '');
      clearError();
    } catch (err) {
      log('conversion error', err);
      showError('Conversion failed. You can input a manual rate below and press "Apply rate".');
      resultEl.innerHTML = `<div class="muted">No result</div>`;
    }
  }

  function swapCurrencies() {
    const a = fromEl.value;
    fromEl.value = toEl.value || '';
    toEl.value = a || '';
  }

  // events
  convertBtn.addEventListener('click', (e) => { e.preventDefault(); convert(); });
  swapBtn.addEventListener('click', (e) => { e.preventDefault(); swapCurrencies(); });
  amountEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') convert(); });

  applyManualBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const r = Number(manualRateEl.value);
    if (!isFinite(r) || r <= 0) { showError('Enter a valid manual rate'); return; }
    convert(true, r);
  });

  testApiBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    clearError();
    try {
      const testUrl = `${API_BASE}/pair/USD/INR`;
      const r = await fetchWithTimeout(testUrl, {}, 9000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const sample = (j.conversion_rate !== undefined) ? j.conversion_rate :
                     (j && j.conversion_rates && j.conversion_rates.INR ? j.conversion_rates.INR : 'N/A');
      alert('API test OK — sample: 1 USD = ' + sample);
      clearError();
    } catch (err) {
      log('API test failed', err);
      showError('API appears unreachable from this page (see console).');
    }
  });

  // init
  loadSymbols();
});
