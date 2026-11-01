import { BlockList, isIP } from 'net';
import type { Request, Response, NextFunction } from 'express';
import { HTTP_STATUS, ERROR_MSG } from '../utils/constants.js';
import logger from '../utils/logger.js';

const VAR = 'BACKOFFICE_ALLOWED_IPS';

function normalize(ip: string): string {
  // Node reports IPv4 clients on a dual-stack socket as ::ffff:a.b.c.d.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped ? mapped[1] : ip;
}

/**
 * Parses a list of IP addresses and CIDR ranges, separated by commas or
 * spaces. Returns null for an empty value (no restriction). Throws on a
 * value that is not valid, so a typing error does not open the backoffice.
 */
export function parseIpAllowList(value: string | undefined): ((ip: string | undefined) => boolean) | null {
  const entries = (value ?? '').split(/[\s,]+/).filter(Boolean);
  if (entries.length === 0) return null;

  const list = new BlockList();
  for (const entry of entries) {
    const [addr, prefix, extra] = entry.split('/');
    const family = isIP(addr);
    if (!family || extra !== undefined) throw new Error(`${VAR}: "${entry}" is not an IP address or CIDR range.`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      list.addAddress(addr, type);
      continue;
    }
    const bits = Number(prefix);
    if (!/^\d+$/.test(prefix) || bits > (family === 4 ? 32 : 128)) {
      throw new Error(`${VAR}: "${entry}" has a prefix length that is not valid.`);
    }
    list.addSubnet(addr, bits, type);
  }

  return (ip) => {
    if (!ip) return false;
    const addr = normalize(ip);
    const family = isIP(addr);
    if (!family) return false;
    return list.check(addr, family === 4 ? 'ipv4' : 'ipv6');
  };
}

/** Express middleware: 403 for a client IP (req.ip) that is not in the list. */
export function ipAllowListMiddleware(value: string | undefined) {
  const allowed = parseIpAllowList(value);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allowed || allowed(req.ip)) {
      next();
      return;
    }
    logger.warn(`[backoffice] Blocked ${req.method} ${req.path} from ${req.ip}`);
    res.status(HTTP_STATUS.FORBIDDEN).json({ error: ERROR_MSG.IP_NOT_ALLOWED });
  };
}
