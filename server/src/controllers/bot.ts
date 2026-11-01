import type { Request, Response } from 'express';
import { ERROR_MSG } from '../utils/constants.js';
import type { BotService } from '../services/bot.js';

export function createBotController(botService: BotService) {
  return {
    getStatus(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(botService.getStatus(userId));
    },
    async start(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(await botService.start(userId));
    },
    stop(req: Request, res: Response) {
      const userId = (req as any).user.id;
      res.json(botService.stop(userId));
    },
    async kill(req: Request, res: Response) {
      const userId = (req as any).user.id;
      const result = await botService.kill(userId);
      res.json({ ...result, message: ERROR_MSG.ALL_POSITIONS_CLOSED });
    },
  };
}
