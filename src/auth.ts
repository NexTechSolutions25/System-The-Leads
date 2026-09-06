import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import {
  all,
  get,
  put,
  remove,
  transaction,
  initDB,
  databaseMessage,
} from "./db.js";
import { config, now } from "./config.js";
const scrypt = promisify(scryptCallback);
const COOKIE = "nextech_session";
const HOURS = 12;
export const sessionId = (raw: string) =>
  createHash("sha256").update(raw).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return "scrypt:" + salt + ":" + hash.toString("hex");
}
export async function verifyPassword(password: string, encoded: string) {
  const [method, salt, stored] = encoded.split(":");
  if (method !== "scrypt" || !salt || !stored || stored.length !== 128)
    return false;
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(stored, "hex");
  return expected.length === hash.length && timingSafeEqual(hash, expected);
}
function cookie(req: Request) {
  const part = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="));
  const value = part?.slice(COOKIE.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
function options(req: Request) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: req.secure,
    path: "/",
  };
}
export async function sessionUser(req: Request) {
  const raw = cookie(req);
  if (!raw) return undefined;
  const sid = sessionId(raw);
  const s = await get("AppSession", sid);
  if (!s) return undefined;
  if (s.expiresAt <= Date.now()) {
    await remove("AppSession", sid);
    return undefined;
  }
  const u = await get("AppUser", s.userId);
  return u ? { id: u.id, username: u.username } : undefined;
}
async function issue(req: Request, res: Response, user: any) {
  const old = cookie(req);
  if (old) await remove("AppSession", sessionId(old));
  const raw = randomBytes(32).toString("hex");
  const id = sessionId(raw);
  await put("AppSession", id, {
    id,
    userId: user.id,
    createdAt: now(),
    expiresAt: Date.now() + HOURS * 3600000,
  });
  res.cookie(COOKIE, raw, { ...options(req), maxAge: HOURS * 3600000 });
  return { id: user.id, username: user.username };
}
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await sessionUser(req);
    if (!user)
      return res.status(401).json({ error: "Entre com seu usuário e senha." });
    res.locals.user = user;
    next();
  } catch {
    res.status(503).json({ error: databaseMessage() });
  }
}
export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
const attempts = new Map<string, { count: number; expires: number }>();
function limit(req: Request, res: Response, next: NextFunction) {
  const ip = req.socket.remoteAddress || "local";
  const time = Date.now();
  for (const [key, value] of attempts)
    if (value.expires <= time) attempts.delete(key);
  let entry = attempts.get(ip);
  if (!entry) {
    entry = { count: 0, expires: time + 15 * 60000 };
    attempts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > 10) {
    res.setHeader(
      "Retry-After",
      String(Math.ceil((entry.expires - time) / 1000)),
    );
    return res
      .status(429)
      .json({
        error: "Muitas tentativas. Aguarde 15 minutos para tentar novamente.",
      });
  }
  next();
}
const credentials = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-zA-Z0-9_.@-]+$/),
  password: z.string().min(8).max(128),
});
authRouter.get("/status", async (req, res) => {
  try {
    await initDB();
    const users = await all("AppUser");
    const user = await sessionUser(req);
    res.json({
      databaseReady: true,
      database: config.dbDriver,
      setupRequired: users.length === 0,
      user: user || null,
    });
  } catch {
    res.json({
      databaseReady: false,
      database: config.dbDriver,
      setupRequired: false,
      user: null,
      message: databaseMessage(),
    });
  }
});
authRouter.post("/setup", limit, async (req, res) => {
  if (
    !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress || "",
    ) ||
    !["127.0.0.1", "localhost", "::1"].includes(config.host)
  )
    return res
      .status(403)
      .json({
        error:
          "Crie o primeiro acesso no computador do servidor, pela conexão local.",
      });
  const input = credentials.parse(req.body);
  const passwordHash = await hashPassword(input.password);
  const user = await transaction(async () => {
    if ((await all("AppUser")).length)
      throw Object.assign(Error("O primeiro acesso já foi configurado."), {
        status: 409,
      });
    const id = "admin";
    const u = {
      id,
      username: input.username.toLowerCase(),
      passwordHash,
      createdAt: now(),
    };
    await put("AppUser", id, u);
    return u;
  });
  res.status(201).json({ user: await issue(req, res, user) });
});
authRouter.post("/login", limit, async (req, res) => {
  const input = credentials.parse(req.body);
  const users = await all("AppUser");
  const u = users.find((x) => x.username === input.username.toLowerCase());
  const fallback = "scrypt:" + "0".repeat(32) + ":" + "0".repeat(128);
  const valid = await verifyPassword(
    input.password,
    u?.passwordHash || fallback,
  );
  if (!u || !valid)
    return res.status(401).json({ error: "Usuário ou senha incorretos." });
  res.json({ user: await issue(req, res, u) });
});
authRouter.post("/logout", async (req, res) => {
  const raw = cookie(req);
  if (raw) await remove("AppSession", sessionId(raw));
  res.clearCookie(COOKIE, options(req));
  res.json({ ok: true });
});
authRouter.post("/password", requireAuth, limit, async (req, res) => {
  const input = z
    .object({
      currentPassword: z.string().min(1).max(128),
      newPassword: z.string().min(8).max(128),
    })
    .parse(req.body);
  const userId = res.locals.user.id;
  const snapshot = await get("AppUser", userId);
  if (
    !snapshot ||
    !(await verifyPassword(input.currentPassword, snapshot.passwordHash))
  )
    return res.status(401).json({ error: "Senha atual incorreta." });
  const nextHash = await hashPassword(input.newPassword);
  await transaction(async () => {
    const current = await get("AppUser", userId);
    if (!current || current.passwordHash !== snapshot.passwordHash)
      throw Error("Senha alterada por outra sessão. Entre novamente.");
    await put("AppUser", userId, {
      ...current,
      passwordHash: nextHash,
      updatedAt: now(),
    });
    for (const s of await all("AppSession"))
      if (s.userId === userId) await remove("AppSession", s.id);
  });
  res.clearCookie(COOKIE, options(req));
  res.json({ ok: true });
});
