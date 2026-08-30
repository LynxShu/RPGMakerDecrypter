/**
 * worker_threads 入口：在独立线程里执行加解密，把主进程的事件循环从
 * 「同步读大文件 + XOR + 写盘」中解放出来（蓝图 §11.2）。
 *
 * electron-vite 的 main 构建以独立 entry 打包成 `out/main/worker.js`，
 * 主进程通过 `new Worker(join(__dirname, 'worker.js'))` 启动。
 */
import { parentPort } from 'node:worker_threads'
import { processDecryptRequest, type DecryptJob, type DecryptResult } from './decryptCore'

export type { DecryptJob, DecryptResult }

// 仅当作为 worker_threads 运行时才挂消息监听；主进程 import 本模块时 parentPort 为 null，不执行。
const port = parentPort
if (port) {
  port.on('message', async (req: DecryptJob) => {
    const res = await processDecryptRequest(req)
    if (res.status === 'ok' && res.data) {
      // 统一转成独立、恰好等长的 ArrayBuffer，可转移（transferable），避免结构化克隆复制。
      const copy = new Uint8Array(res.data).buffer
      port.postMessage({ ...res, data: copy }, [copy])
    } else {
      port.postMessage(res)
    }
  })
}
