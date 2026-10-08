/**
 * 极简 WebSocket 客户端（仅覆盖 CDP 注入所需：握手 + 收发文本帧）
 * 用途：当系统没有任何可用的 ws 模块时的零依赖 fallback。
 * 仅支持 ws:// 明文连接（CDP 调试端口正是 ws://127.0.0.1）。
 */
'use strict';
const { EventEmitter } = require('events');
const net = require('net');
const crypto = require('crypto');

class MiniWebSocket extends EventEmitter {
  constructor(url) {
    super();
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(.*)$/);
    if (!m) throw new Error('mini-ws: only ws:// supported, got ' + url);
    this._host = m[1];
    this._port = parseInt(m[2], 10);
    this._path = m[3] || '/';
    this._buf = Buffer.alloc(0);
    this._fragments = [];
    this._connect();
  }

  _connect() {
    const key = crypto.randomBytes(16).toString('base64');
    this._sock = net.connect(this._port, this._host, () => {
      this._sock.write(
        `GET ${this._path} HTTP/1.1\r\n` +
        `Host: ${this._host}:${this._port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    this._sock.on('data', (d) => this._onData(d));
    this._sock.on('error', (e) => this.emit('error', e));
    this._sock.on('close', () => this.emit('close'));
  }

  _onData(d) {
    this._buf = Buffer.concat([this._buf, d]);
    if (!this._handshaked) {
      const idx = this._buf.indexOf('\r\n\r\n');
      if (idx === -1) return;
      const head = this._buf.slice(0, idx).toString();
      if (!/101/.test(head.split('\r\n')[0])) {
        this.emit('error', new Error('mini-ws: handshake failed'));
        this._sock.destroy();
        return;
      }
      this._buf = this._buf.slice(idx + 4);
      this._handshaked = true;
      this.emit('open');
    }
    // 解析帧
    while (true) {
      const frame = this._parseFrame();
      if (!frame) break;
      const { opcode, payload } = frame;
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        this._fragments.push(payload);
        if (frame.fin) {
          const full = this._fragments.length === 1 ? this._fragments[0] : Buffer.concat(this._fragments);
          this._fragments = [];
          this.emit('message', full.toString());
        }
      } else if (opcode === 0x8) {
        // close
        this._sock.destroy();
        this.emit('close');
        return;
      } else if (opcode === 0x9) {
        // ping → pong
        this._sendFrame(0xA, payload);
      }
      // 0xA pong：忽略
    }
  }

  _parseFrame() {
    const b = this._buf;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return null;
      len = b.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (b.length < 10) return null;
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(64 * 1024 * 1024)) { this._sock.destroy(); return null; }
      len = Number(big);
      off = 10;
    }
    if (masked) off += 4; // CDP 服务端帧不带 mask
    if (b.length < off + len) return null;
    const payload = b.slice(off, off + len);
    this._buf = b.slice(off + len);
    return { fin, opcode, payload };
  }

  _sendFrame(opcode, payload) {
    const mask = crypto.randomBytes(4);
    let header;
    if (payload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | payload.length]);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    const maskedPayload = Buffer.allocUnsafe(payload.length);
    for (let i = 0; i < payload.length; i++) maskedPayload[i] = payload[i] ^ mask[i & 3];
    this._sock.write(Buffer.concat([header, mask, maskedPayload]));
  }

  send(str) {
    this._sendFrame(0x1, Buffer.from(str, 'utf8'));
  }

  close() {
    try { this._sendFrame(0x8, Buffer.alloc(0)); } catch (e) {}
    try { this._sock.destroy(); } catch (e) {}
    this.emit('close');
  }
}

module.exports = MiniWebSocket;
