import TcpSocket from 'react-native-tcp-socket';

export interface IMUFrame {
  ts: number;
  ax: number; ay: number; az: number;
  gx: number; gy: number; gz: number;
  r: number;  p: number;  y: number;
  mx: number; my: number; mz: number;
}

type FrameCallback = (frame: IMUFrame) => void;

export class IMUClient {
  private socket: any = null;
  private buffer = '';
  private callbacks: FrameCallback[] = [];
  private _connected = false;
  private _streaming = false;

  get connected() { return this._connected; }
  get streaming() { return this._streaming; }

  connect(ip: string, port = 8765): Promise<boolean> {
    return new Promise((resolve) => {
      console.log(`[IMUClient] Connecting to ${ip}:${port}...`);

      this.socket = TcpSocket.createConnection({ host: ip, port }, () => {
        console.log(`[IMUClient] TCP socket opened to ${ip}:${port}`);
      });

      this.socket.on('data', (raw: Buffer | string) => {
        const chunk = typeof raw === 'string' ? raw : raw.toString('utf8');

        if (!this._connected) {
          console.log(`[IMUClient] Handshake received: "${chunk.trim()}"`);
          if (chunk.trim() === 'OK') {
            this._connected = true;
            console.log('[IMUClient] Handshake OK — connected');
            resolve(true);
          } else {
            console.warn(`[IMUClient] Unexpected handshake response, destroying socket`);
            this.socket.destroy();
            resolve(false);
          }
          return;
        }

        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('{')) {
            if (trimmed.length > 0) console.warn(`[IMUClient] Non-JSON line: "${trimmed}"`);
            continue;
          }
          try {
            const frame: IMUFrame = JSON.parse(trimmed);
            this.callbacks.forEach(cb => cb(frame));
          } catch (e) {
            console.warn(`[IMUClient] JSON parse error: ${e} — line: "${trimmed}"`);
          }
        }
      });

      this.socket.on('error', (err: any) => {
        console.error(`[IMUClient] Socket error:`, err);
        this._connected = false;
        this._streaming = false;
        resolve(false);
      });

      this.socket.on('close', (hasError: boolean) => {
        console.log(`[IMUClient] Socket closed (hasError=${hasError})`);
        this._connected = false;
        this._streaming = false;
      });
    });
  }

  start() {
    if (!this._connected) {
      console.warn('[IMUClient] start() called but not connected');
      return;
    }
    console.log('[IMUClient] Sending START');
    this._streaming = true;
    this.socket.write('START\n');
  }

  stop() {
    if (!this._streaming) {
      console.warn('[IMUClient] stop() called but not streaming');
      return;
    }
    console.log('[IMUClient] Sending STOP');
    this._streaming = false;
    this.socket.write('STOP\n');
  }

  disconnect() {
    console.log('[IMUClient] Disconnecting...');
    if (this._streaming) this.stop();
    if (this.socket) {
      this.socket.write('DISCONNECT\n');
      this.socket.destroy();
      this.socket = null;
      console.log('[IMUClient] Socket destroyed');
    }
    this._connected = false;
  }

  onFrame(cb: FrameCallback) { this.callbacks.push(cb); }
  clearCallbacks() { this.callbacks = []; }
}