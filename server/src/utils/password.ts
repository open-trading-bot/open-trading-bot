const MIN_LENGTH = 8;

export function isPasswordValid(password: string): boolean {
  if (typeof password !== 'string') return false;
  if (password.length < MIN_LENGTH) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
}
