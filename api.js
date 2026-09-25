/* KSV D3 Coach Tracker - Apps Script bridge */
(() => {
  'use strict';

  const BACKEND_KEY = 'ksvTracker.backendUrl';
  const TOKEN_KEY = 'ksvTracker.sessionToken';

  class KsvApi {
    getBackendUrl() {
      return (localStorage.getItem(BACKEND_KEY) || '').trim();
    }

    setBackendUrl(url) {
      const cleaned = String(url || '').trim().replace(/\/+$/, '');
      if (cleaned && !/^https:\/\/script\.google\.com\/macros\/s\//.test(cleaned)) {
        throw new Error('Paste the Apps Script Web App URL that starts with https://script.google.com/macros/s/...');
      }
      localStorage.setItem(BACKEND_KEY, cleaned);
    }

    clearBackendUrl() {
      localStorage.removeItem(BACKEND_KEY);
      this.clearToken();
    }

    getToken() {
      return sessionStorage.getItem(TOKEN_KEY) || '';
    }

    setToken(token) {
      sessionStorage.setItem(TOKEN_KEY, String(token || ''));
    }

    clearToken() {
      sessionStorage.removeItem(TOKEN_KEY);
    }

    async health() {
      return this.request('health', {}, { auth: false });
    }

    async login(password) {
      const res = await this.request('login', { password }, { auth: false });
      if (res && res.token) this.setToken(res.token);
      return res;
    }

    async call(action, data = {}) {
      return this.request(action, data, { auth: true });
    }

    async request(action, data, options = {}) {
      const backendUrl = this.getBackendUrl();
      if (!backendUrl) throw new Error('Backend URL is not configured.');

      const requestId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      // Apps Script HTML Service can add an internal iframe around the returned page.
      // A random bridge key lets us safely accept the reply even when event.source
      // is the inner Google frame rather than the iframe element we created here.
      const bridgeKey = 'b_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      const token = options.auth === false ? '' : this.getToken();
      if (options.auth !== false && !token) throw new Error('Please sign in first.');

      const payload = JSON.stringify({ action, data, token });
      return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.name = 'ksv_bridge_' + requestId;
        iframe.title = 'KSV data bridge';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-9999px;top:-9999px;';

        const form = document.createElement('form');
        form.method = 'POST';
        form.action = backendUrl;
        form.target = iframe.name;
        form.enctype = 'application/x-www-form-urlencoded';
        form.style.display = 'none';

        const payloadInput = document.createElement('input');
        payloadInput.type = 'hidden';
        payloadInput.name = 'payload';
        payloadInput.value = payload;

        const requestInput = document.createElement('input');
        requestInput.type = 'hidden';
        requestInput.name = 'request_id';
        requestInput.value = requestId;

        const bridgeInput = document.createElement('input');
        bridgeInput.type = 'hidden';
        bridgeInput.name = 'bridge_key';
        bridgeInput.value = bridgeKey;

        form.appendChild(payloadInput);
        form.appendChild(requestInput);
        form.appendChild(bridgeInput);
        document.body.appendChild(iframe);
        document.body.appendChild(form);

        let settled = false;
        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          clearTimeout(timer);
          setTimeout(() => {
            form.remove();
            iframe.remove();
          }, 50);
        };

        const onMessage = (event) => {
          const msg = event.data;
          if (!msg || msg.__ksvBridge !== true || msg.requestId !== requestId || msg.bridgeKey !== bridgeKey) return;
          if (settled) return;
          settled = true;
          cleanup();
          const response = msg.payload || {};
          if (!response.ok) {
            const error = new Error(response.error || 'Backend request failed.');
            if (/session/i.test(error.message)) this.clearToken();
            reject(error);
            return;
          }
          resolve(response.result);
        };

        window.addEventListener('message', onMessage);
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error('Backend request timed out. Check the Apps Script deployment URL and access setting.'));
        }, 30000);

        form.submit();
      });
    }
  }

  window.ksvApi = new KsvApi();
})();
