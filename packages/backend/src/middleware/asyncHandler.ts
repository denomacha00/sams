import { type Request, type Response, type NextFunction, type RequestHandler } from 'express';

/** Forward async route rejections to Express errorHandler instead of crashing the process. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
