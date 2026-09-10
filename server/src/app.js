import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import morgan from 'morgan';
import { pool } from './db.js';
import { attachUser } from './middleware/auth.js';
import { HttpError } from './lib/http.js';
import { resolveSessionSecret } from './lib/session-secret.js';
import authRoutes from './routes/auth.js';

const PgStore = connectPgSimple(session);

// body-parser error types we can actually reach, mapped to this API's
// snake_case error vocabulary. Anything else 4xx becomes 'bad_request'.
const CLIENT_ERROR_CODES = {
  'entity.parse.failed': 'malformed_json',
  'entity.too.large': 'payload_too_large',
  'entity.verify.failed': 'malformed_json',
  'request.aborted': 'request_aborted',
  'request.size.invalid': 'bad_content_length',
  'parameters.too.many': 'too_many_parameters',
  'charset.unsupported': 'unsupported_charset',
  'encoding.unsupported': 'unsupported_encoding',
};

export function createApp() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // Throws in production rather than falling back to a guessable secret; in
  // development it returns a per-process random one and tells us it did.
  const { secret: sessionSecret, warning } = resolveSessionSecret();
  if (warning && process.env.NODE_ENV !== 'test') console.warn(`WARNING: ${warning}`);

  app.set('trust proxy', 1);
  app.use(helmet());
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));
  app.use(express.json({ limit: '64kb' }));

  // The Vite dev server runs on a different origin, so the browser needs an
  // explicit CORS allowance to send the session cookie. One fixed origin from
  // the environment -- not a cors package, and never a wildcard, because
  // credentials: 'include' forbids `*`.
  app.use((req, res, next) => {
    const origin = process.env.CLIENT_ORIGIN;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.header('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use(
    session({
      name: 'sid',
      store: new PgStore({ pool, tableName: 'user_session', createTableIfMissing: false }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,           // the token is never readable from JS
        sameSite: 'lax',
        secure: isProd,           // requires HTTPS in production
        maxAge: 1000 * 60 * 60 * 24 * 14,
      },
    }),
  );

  app.use(attachUser);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);

  app.use((_req, res) => res.status(404).json({ error: 'no_such_route' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, ...(err.extra || {}) });
    }

    // express.json() and friends reject a bad request by throwing an error that
    // already carries its own 4xx status: a body that is not valid JSON, or one
    // over the 64kb limit. Those are the caller's mistake, so they must keep
    // that status. Answering 500 tells the caller to retry something that can
    // never succeed, and logging it as a server fault buries the real ones.
    //
    // The code comes from err.type, never err.message: body-parser sets
    // `expose: true` and puts a slice of the offending body in the message.
    const status = err.status ?? err.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      return res.status(status).json({ error: CLIENT_ERROR_CODES[err.type] || 'bad_request' });
    }

    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
