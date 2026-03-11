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
export async function authenticate(address: string, walletType: 'evm' | 'solana' = 'evm'): Promise<string> {
  // 1. Get nonce message
  const nonceRes = await fetch(`${API_BASE}/auth/nonce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });

  if (!nonceRes.ok) throw new Error('Failed to get nonce');
  const { message } = await nonceRes.json();

  // 2. Sign with the appropriate wallet
  let signature: string;

  if (walletType === 'solana') {
    const sol = (window as any).phantom?.solana ?? (window as any).solana;
    if (!sol) throw new Error('Solana wallet not found');
    try {
      const encoded = new TextEncoder().encode(message);
      const { signature: sigBytes } = await sol.signMessage(encoded, 'utf8');
      // Convert Uint8Array to hex string
      signature = '0x' + Array.from(sigBytes as Uint8Array)
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      throw new Error('Solana signing rejected');
    }
  } else {
    // EVM (MetaMask, Rabby, etc.)
    const eth = (window as any).ethereum;
    if (!eth) throw new Error('EVM wallet not found');
    try {
      await eth.request({ method: 'eth_requestAccounts' });
      signature = await eth.request({
        method: 'personal_sign',
        params: [message, address],
      });
    } catch {
      throw new Error('EVM signing rejected');
    }
  }

  // 3. Verify — backend requires the original nonce message back
  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, message, signature, walletType }),
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
