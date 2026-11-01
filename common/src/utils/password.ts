export const PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireDigit: true,
  requireSymbol: true,
} as const;

export interface PasswordCheck {
  minLength: boolean;
  hasUppercase: boolean;
  hasDigit: boolean;
  hasSymbol: boolean;
}

export function checkPassword(password: string): PasswordCheck {
  return {
    minLength: password.length >= PASSWORD_RULES.minLength,
    hasUppercase: /[A-Z]/.test(password),
    hasDigit: /[0-9]/.test(password),
    hasSymbol: /[^A-Za-z0-9]/.test(password),
  };
}

export function isPasswordValid(password: string): boolean {
  const check = checkPassword(password);
  return check.minLength && check.hasUppercase && check.hasDigit && check.hasSymbol;
}

const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

export function generatePassword(length = 14): string {
  const rand = (chars: string) => chars[crypto.getRandomValues(new Uint8Array(1))[0] % chars.length];
  const required = [rand(UPPER), rand(LOWER), rand(DIGITS), rand(SYMBOLS)];
  const rest = Array.from(crypto.getRandomValues(new Uint8Array(length - required.length)), (b) => ALL[b % ALL.length]);
  const all = [...required, ...rest];
  for (let i = all.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint8Array(1))[0] % (i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.join('');
}
