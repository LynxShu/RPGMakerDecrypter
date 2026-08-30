/**
 * 加解密线程池（worker_threads）+ 取消 + 进度上报 + 单任务超时。
 *
 * 设计（蓝图 §11.2）：
 * - 用真实 `worker_threads` 跑耗时较大的「读文件 + XOR + 写盘」，主进程事件循环不被阻塞。
 * - 任务被拆成原子单元，取消即「停止派发新任务」，在途任务快速收尾（不会中途丢半截文件）。
 * - 提供内联回退：若 worker 入口无法实例化（如测试/未打包场景），改用 `fs.promises` 异步执行，
 *   保证功能仍可用（只是不在独立线程）。
 * - **单任务超时**（jobTimeoutMs，默认 60s）：某个文件读取卡住（网络盘/损坏文件等）不会
 *   让整批任务永久挂起——超时按 fail 处理并继续下一个，进度持续推进，UI 不会"卡死无提示"。
 * - **进度带当前文件**：每派发一个任务先上报一次 `current`（正在处理的 relPath），
 *   用户能实时看到卡在哪个文件；完成一个再上报一次计数。
 */
import { Worker } from 'node:worker_threads'
import { availableParallelism, cpus } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  processDecryptRequest,
  type DecryptJob,
  type DecryptResult
} from './decryptCore'

export interface DecryptPoolOptions {
  /** worker 入口（打包后为 out/main/worker.js）；缺省用本模块同目录下的 worker.js */
  workerPath?: string
  /** 最大并发线程数（缺省 min(8, 可用核心)） */
  maxWorkers?: number
  /** 取消信号：触发后不再派发新任务，在途任务尽快收尾 */
  signal?: AbortSignal
  /** 单个任务超时毫秒（默认 60_000；超时按 fail 处理并继续） */
  jobTimeoutMs?: number
}

export interface DecryptRunSummary {
  ok: number
  fail: number
  canceled: boolean
  /** 所有任务的结果（含失败项）。Zip 导出用它拼装输出；磁盘导出 data 为空。 */
  results: DecryptResult[]
}

/** 进度回调：done/total/ok/fail 为已完成计数；current 为当前正在处理的文件 relPath */
export type DecryptProgressFn = (
  done: number,
  total: number,
  ok: number,
  fail: number,
  current?: string
) => void

/** 默认单任务超时（ms） */
export const DEFAULT_JOB_TIMEOUT_MS = 60_000

/** 某个「时隙」可以执行一个任务：在 worker 是发送消息并等待回包，在内联是直接 await 执行 */
interface Slot {
  run: (job: DecryptJob) => Promise<DecryptResult>
  /** 中断在途任务（worker：terminate 线程；内联：无操作，靠超时兜底） */
  abort: () => void
}

function defaultWorkerCount(): number {
  try {
    if (typeof availableParallelism === 'function') {
      const n = availableParallelism()
      if (n > 0) return n
    }
  } catch {
    /* ignore */
  }
  try {
    return cpus().length || 4
  } catch {
    return 4
  }
}

function createSlots(count: number, workerPath: string): { slots: Slot[]; dispose: () => void } {
  // worker 入口不存在（未打包 / 测试环境）→ 全部走内联回退（异步 fs，不阻塞）。
  const canUseWorker = existsSync(workerPath)
  const slots: Slot[] = []
  const disposers: Array<() => void> = []
  for (let i = 0; i < count; i++) {
    if (!canUseWorker) {
      slots.push({ run: (job) => processDecryptRequest(job), abort: () => {} })
      continue
    }

    let worker: Worker
    try {
      worker = new Worker(workerPath)
    } catch {
      // worker 无法创建 → 内联回退
      slots.push({ run: (job) => processDecryptRequest(job), abort: () => {} })
      continue
    }

    let pending: { id: number; resolve: (r: DecryptResult) => void } | null = null
    // worker 启动失败 / 中途崩溃后置为不可用，后续任务转内联，保证功能不中断。
    let usable = true

    const failInFlight = (err: unknown): void => {
      if (!pending) return
      const p = pending
      pending = null
      p.resolve({ id: p.id, status: 'fail', error: String(err), relPath: '', ext: '' })
    }

    // worker 回复后按匹配的 id 唤醒对应 promise。
    worker.on('message', (msg: DecryptResult) => {
      if (!pending || msg.id !== pending.id) return
      const p = pending
      pending = null
      // 把从 worker 以 transferable ArrayBuffer 回传的数据归一化为 Uint8Array。
      if (msg.data && !(msg.data instanceof Uint8Array)) {
        msg.data = new Uint8Array(msg.data)
      }
      p.resolve(msg)
    })
    worker.on('error', (err) => {
      usable = false
      failInFlight(err)
    })
    worker.on('exit', (code) => {
      usable = false
      failInFlight(new Error(`worker exited (${code})`))
    })

    disposers.push(() => {
      try {
        worker.terminate()
      } catch {
        /* ignore */
      }
    })

    slots.push({
      run: (job) => {
        if (!usable) return processDecryptRequest(job)
        return new Promise<DecryptResult>((resolve) => {
          pending = { id: job.id, resolve }
          try {
            worker.postMessage(job)
          } catch (err) {
            usable = false
            pending = null
            resolve({ id: job.id, status: 'fail', error: String(err), relPath: job.relPath, ext: job.ext })
          }
        })
      },
      // 超时/取消时终止该 worker，使在途 promise 尽快 resolve（'exit' 事件触发 failInFlight）
      abort: () => {
        try {
          worker.terminate()
        } catch {
          /* ignore */
        }
      }
    })
  }
  return { slots, dispose: () => { for (const d of disposers) d() } }
}

/**
 * 并行跑一批加解密任务。
 *
 * @param jobs              任务列表（由调用方按文件映射生成）
 * @param opts              workerPath / 并发 / 取消信号 / 单任务超时
 * @param onProgress        进度回调（done, total, ok, fail, current?）
 * @returns 统计 + 结果列表
 */
export async function runDecryptJobs(
  jobs: DecryptJob[],
  opts: DecryptPoolOptions,
  onProgress: DecryptProgressFn
): Promise<DecryptRunSummary> {
  const total = jobs.length
  if (total === 0) return { ok: 0, fail: 0, canceled: false, results: [] }

  const signal = opts.signal
  const workerPath = opts.workerPath ?? join(__dirname, 'worker.js')
  const timeoutMs = opts.jobTimeoutMs ?? DEFAULT_JOB_TIMEOUT_MS
  const maxWorkers = Math.max(1, Math.min(opts.maxWorkers ?? 8, defaultWorkerCount()))
  const { slots, dispose } = createSlots(Math.min(maxWorkers, total), workerPath)

  let cursor = 0
  let done = 0
  let ok = 0
  let fail = 0
  const results: DecryptResult[] = []

  const handleResult = (r: DecryptResult): void => {
    done++
    if (r.status === 'ok') ok++
    else fail++
    results.push(r)
    onProgress(done, total, ok, fail)
  }

  /** 执行单个任务：超时 / 取消都立即返回（不阻塞整批），失败原因带进结果 */
  function runWithGuards(slot: Slot, job: DecryptJob): Promise<DecryptResult> {
    return new Promise<DecryptResult>((resolve) => {
      let settled = false
      const finish = (r: DecryptResult): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(r)
      }
      const timer = setTimeout(() => {
        slot.abort() // 终止 worker，让在途 promise 尽快结束
        finish({
          id: job.id,
          status: 'fail',
          error: `处理超时（${Math.round(timeoutMs / 1000)}s）`,
          relPath: job.relPath,
          ext: job.ext
        })
      }, timeoutMs)
      const onAbort = (): void => {
        slot.abort()
        finish({ id: job.id, status: 'fail', error: '已取消', relPath: job.relPath, ext: job.ext })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      slot.run(job).then(finish, (e) =>
        finish({ id: job.id, status: 'fail', error: String(e), relPath: job.relPath, ext: job.ext })
      )
    })
  }

  // 每个时隙一条「流水线」：顺序取下一个任务执行；取消或取完则返回。
  async function pump(slot: Slot): Promise<void> {
    while (cursor < total && !signal?.aborted) {
      const job = jobs[cursor++]
      // 先上报"正在处理"（进度不动，但用户能看到卡在哪个文件）
      onProgress(done, total, ok, fail, job.relPath)
      const r = await runWithGuards(slot, job)
      handleResult(r)
    }
  }

  try {
    await Promise.all(slots.map((s) => pump(s)))
  } finally {
    // 任务结束/被取消后回收所有 worker 线程，避免长期运行的应用泄漏线程。
    dispose()
  }

  return { ok, fail, canceled: signal?.aborted ?? false, results }
}
