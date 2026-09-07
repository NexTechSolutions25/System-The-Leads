import { randomUUID } from 'node:crypto';
import { all, get, put, remove, transaction, initDB, getRun, updateRun } from './db.js';
import { execute } from './engine.js';
import { now } from './config.js';
const LOCK = 'free-queue-lock';
const PREFIX = 'free-job:';
let stopped = false;
let active: Promise<void> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
export async function ready() { await initDB(); }
export const queue = {
  async add(name: string, data: any, opts?: { jobId?: string }) {
    const id = PREFIX + (opts?.jobId || data.runId || randomUUID());
    await transaction(async () => {
      if (!(await get('AppMeta', id))) await put('AppMeta', id, { id, name, data, at: now() });
    });
    void tick();
    return { id };
  },
  async getJobSchedulers(..._args: any[]) { return []; },
  async upsertJobScheduler(..._args: any[]) { throw Error('No modo gratuito, use Iniciar captação. Agendas não são executadas enquanto o serviço está suspenso.'); },
  async removeJobScheduler(..._args: any[]) { return true; },
  async close() {
    stopped = true;
    if (timer) clearInterval(timer);
    await active;
  },
};
export function start() {
  stopped = false;
  timer = setInterval(() => void tick(), 3000);
  timer.unref();
  void tick();
}
export function tick() {
  if (stopped || active) return active;
  active = work().catch(() => console.error('[free-queue] Falha ao acessar a fila; nova tentativa em instantes.')).finally(() => { active = undefined; });
  return active;
}
async function work() {
  const token = randomUUID();
  const job = await transaction(async () => {
    const lock = await get('AppMeta', LOCK);
    if (lock?.until > Date.now()) return;
    const jobs = (await all('AppMeta')).filter(x => x.id.startsWith(PREFIX)).sort((a,b) => a.at.localeCompare(b.at));
    for (const candidate of jobs) {
      if (candidate.data.runId && (await getRun(candidate.data.runId))?.control === 'paused') continue;
      await put('AppMeta', LOCK, { id: LOCK, token, until: Date.now() + 120000 });
      return candidate;
    }
  });
  if (!job) return;
  let lost = false;
  const heartbeat = setInterval(() => {
    void transaction(async () => {
      const lock = await get('AppMeta', LOCK);
      if (lock?.token !== token) { lost = true; return; }
      await put('AppMeta', LOCK, { ...lock, until: Date.now() + 120000 });
    }).catch(() => { lost = true; });
  }, 20000);
  const checkpoint = async () => {
    const run = job.data.runId ? await getRun(job.data.runId) : undefined;
    if (stopped || lost || run?.control === 'paused') throw Object.assign(Error('Execução interrompida; mantida na fila.'), { code: 'FREE_INTERRUPTED' });
  };
  try {
    await checkpoint();
    if (job.name === 'capture') await execute(job.data.runId, { checkpoint });
    else if (job.name === 'reanalyze') await (await import('./review.js')).reanalyze(job.data.leadId);
    else throw Error('Tarefa desconhecida');
    await transaction(async () => {
      if ((await get('AppMeta', LOCK))?.token === token) await remove('AppMeta', job.id);
    });
  } catch (error: any) {
    if (error.code !== 'FREE_INTERRUPTED') {
      if (job.data.runId) await updateRun(job.data.runId, { status: 'falhou', errors: [{ at: now(), message: error.message }] });
      await remove('AppMeta', job.id);
      console.error('[free-queue] Execução falhou.');
    }
  } finally {
    clearInterval(heartbeat);
    await transaction(async () => {
      if ((await get('AppMeta', LOCK))?.token === token) await remove('AppMeta', LOCK);
    });
  }
}
