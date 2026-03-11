import { API_BASE } from '../config/constants';

const TOKEN_KEY = 'nova_universe_token';
const ADDR_KEY  = 'nova_universe_address';

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredAddress(): string | null {
  return sessionStorage.getItem(ADDR_KEY);
}

export function clearAuth() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(ADDR_KEY);
}

/** Full auth flow: fetch nonce → sign → verify → store JWT */
export async function authenticate(address: string): Promise<string> {
  // 1. Get nonce message
  const nonceRes = await fetch(`${API_BASE}/auth/nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });

  if (!nonceRes.ok) throw new Error('Failed to get nonce');
  const { message } = await nonceRes.json();

  // 2. Sign with MetaMask / window.ethereum if available
  let signature: string;

  if (typeof (window as any).ethereum !== 'undefined') {
    try {
      const eth = (window as any).ethereum;
      await eth.request({ method: 'eth_requestAccounts' });
      signature = await eth.request({
        method: 'personal_sign',
        params: [message, address],
      });
    } catch {
      // Fall through to mock signature for dev
      signature = '0x' + '0'.repeat(130);
    }
  } else {
    // Dev mode: mock signature (backend must accept in dev)
    signature = '0x' + '0'.repeat(130);
  }

  // 3. Verify
  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });

  if (!verifyRes.ok) throw new Error('Signature verification failed');
  const { token } = await verifyRes.json();

  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(ADDR_KEY, address);

  return token;
}

/** Authenticated fetch wrapper */
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const token = getStoredToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });

  if (res.status === 401) {
    clearAuth();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
