import { create } from 'zustand';

interface AuthStore {
  token: string | null;
  role: string | null;
  username: string | null;
  email: string | null;
  disclaimerAccepted: boolean;
  setToken: (
    token: string | null,
    role?: string | null,
    username?: string | null,
    email?: string | null,
    disclaimerAccepted?: boolean,
  ) => void;
  setDisclaimerAccepted: (accepted: boolean) => void;
  logout: () => void;
  isDemo: () => boolean;
  isAdmin: () => boolean;
  isRegular: () => boolean;
}

const stored = localStorage.getItem('token');
const storedRole = localStorage.getItem('role');
const storedUsername = localStorage.getItem('username');
const storedEmail = localStorage.getItem('email');
const storedDisclaimer = localStorage.getItem('disclaimerAccepted') === '1';

export const useAuthStore = create<AuthStore>((set, get) => ({
  token: stored,
  role: storedRole,
  username: storedUsername,
  email: storedEmail,
  disclaimerAccepted: storedDisclaimer,
  setToken: (token, role, username, email, disclaimerAccepted) => {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
    if (role) localStorage.setItem('role', role);
    else localStorage.removeItem('role');
    if (username) localStorage.setItem('username', username);
    else localStorage.removeItem('username');
    if (email) localStorage.setItem('email', email);
    else localStorage.removeItem('email');
    if (disclaimerAccepted != null) {
      localStorage.setItem('disclaimerAccepted', disclaimerAccepted ? '1' : '0');
    }
    set({
      token,
      role: role ?? null,
      username: username ?? null,
      email: email ?? null,
      disclaimerAccepted: disclaimerAccepted ?? false,
    });
  },
  setDisclaimerAccepted: (accepted) => {
    localStorage.setItem('disclaimerAccepted', accepted ? '1' : '0');
    set({ disclaimerAccepted: accepted });
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('username');
    localStorage.removeItem('email');
    localStorage.removeItem('disclaimerAccepted');
    set({ token: null, role: null, username: null, email: null, disclaimerAccepted: false });
  },
  isDemo: () => get().role === 'demo',
  isAdmin: () => get().role === 'admin',
  isRegular: () => get().role === 'regular',
}));
