/** Read-only CIW transport. The server separately enforces the viewer boundary. */
export class CiwReadClient {
  private socket: WebSocket;
  private opened: Promise<void>;
  private serial = 0;
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>; sourceId: string }>();
  private status: (message: string) => void;

  constructor(endpoint: string, status: (message: string) => void = () => {}) {
    const url = new URL(endpoint);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.pathname !== '/spatial' || url.username || url.password || url.search || url.hash)
      throw new Error('Use an explicit ws(s) CIW /spatial viewer endpoint');
    this.status = status;
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.socket.close(); reject(new Error('CIW connection timed out')); }, 10000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); status('CONNECTED · READ ONLY'); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CIW viewer unavailable; check endpoint and allowed origin')); }, { once: true });
      this.socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('CIW connection closed')); }, { once: true });
    });
    // A caller may construct a client before requesting a view. Retain the
    // rejected promise for inspect(), without an unhandled startup rejection.
    void this.opened.catch(() => {});
    this.socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || event.data.length > 400000) { this.fail('CIW response exceeds viewer budget'); this.socket.close(); return; }
      let message;
      try { message = JSON.parse(event.data); } catch { this.fail('Invalid CIW response'); this.socket.close(); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message) ||
          message.protocol_version !== 1 || typeof message.type !== 'string') {
        this.fail('Invalid CIW response envelope'); this.socket.close(); return;
      }
      if (message.type === 'workbench.changed') { status('CONNECTED · CATALOG CHANGED · RETAINED SOURCE'); return; }
      const request = this.pending.get(message.request_id);
      if (!request) return;
      this.pending.delete(message.request_id); clearTimeout(request.timer);
      if (message.type !== 'response') request.reject(new Error(message.payload?.message ?? 'CIW read refused'));
      else if (message.payload?.source?.source_id !== request.sourceId)
        request.reject(new Error('CIW response substituted the selected geographic source'));
      else request.resolve(message.payload);
    });
    this.socket.addEventListener('close', () => this.fail('OFFLINE · RETAINED SNAPSHOT'));
  }

  private fail(reason: string): void {
    this.status(reason);
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error(reason)); }
    this.pending.clear();
  }

  async inspect(sourceId: string): Promise<unknown> {
    if (!/^source:sha256:[0-9a-f]{64}$/.test(sourceId)) throw new Error('Select an exact retained CIW source identity');
    await this.opened;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('CIW connection unavailable');
    const requestId = 'gsv-read-' + ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('CIW read timed out')); }, 10000);
      this.pending.set(requestId, { resolve, reject, timer, sourceId });
      this.socket.send(JSON.stringify({ protocol_version: 1, request_id: requestId, type: 'spatial.inspect', payload: { source_id: sourceId } }));
    });
  }

  close(): void { this.socket.close(); this.fail('CLOSED · RETAINED SNAPSHOT'); }
}
