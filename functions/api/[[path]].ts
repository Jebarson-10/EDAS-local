/**
 * Cloudflare Pages Function catch-all for /api/* → Worker API.
 *
 * Pages invokes the exported `onRequest`; a bare default export is only
 * honoured in advanced mode (_worker.js), so it is adapted here.
 */
import worker, { type Env } from "../../worker/src/index";

export const onRequest = (context: {
  request: Request;
  env: Env;
}): Promise<Response> => worker.fetch(context.request, context.env);
