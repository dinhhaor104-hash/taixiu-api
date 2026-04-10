const WebSocket = require("ws");

const WS_URL = "wss://cyanb90j.cq.qnwxdhwica.com:443";

let results = [];
let heartbeatInterval = null;

function hexToBytes(hex) {
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2)
    bytes.push(parseInt(hex.substr(i, 2), 16));
  return Buffer.from(bytes);
}

function readVarint(bytes, idx) {
  let result = 0, shift = 0, i = idx;
  while (i < bytes.length && shift <= 28) {
    const b = bytes[i];
    result |= (b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value: result >>> 0, nextIdx: i };
}

function toLooseAscii(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b >= 32 && b < 127 ? String.fromCharCode(b) : " ";
  }
  return s;
}

function connect() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  console.log(`[WS] Đang kết nối ${WS_URL}...`);
  const ws = new WebSocket(WS_URL, {
    headers: {
      "Origin": "https://68gbvn88.bar",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://68gbvn88.bar/"
    }
  });

  ws.on("open", () => {
    console.log("[WS] Đã kết nối, đang handshake...");

    // 1. Handshake sys
    ws.send(hexToBytes("010000727b22737973223a7b22706c6174666f726d223a226a732d776562736f636b6574222c22636c69656e744275696c644e756d626572223a22302e302e31222c22636c69656e7456657273696f6e223a223061323134383164373436663932663834323865316236646565623736666561227d7d"));

    // 2. Heartbeat ack
    ws.send(hexToBytes("02000000"));

    // 3. Auth (guest token)
    ws.send(hexToBytes("0400004d01010001080210ca011a40393461633035333762663330343362313932373236656238636464333361326361303065386561616664393134616236383266663034366662306661383738654200"));

    // Heartbeat mỗi 15s
    heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(hexToBytes("02000000"));
      }
    }, 15000);
  });

  ws.on("message", (data) => {
    try {
      const bytes = new Uint8Array(data);
      const ascii = toLooseAscii(bytes);

      // Sau khi auth xong, vào game room
      if (ascii.includes("entergameroom") || ascii.includes("getgamelist")) {
        // Gửi entergameroom
        ws.send(hexToBytes("040000250004226d6e6d6473622e6d6e6d64736268616e646c65722e656e74657267616d65726f6f6d"));
      }

      if (!ascii.includes("mnmdsbgameend")) return;

      const m = ascii.match(/\{(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\}/);
      const d1 = m ? +m[1] : null;
      const d2 = m ? +m[2] : null;
      const d3 = m ? +m[3] : null;
      const sum = d1 != null ? d1 + d2 + d3 : null;
      const result = sum != null ? (sum > 10 ? "TAI" : "XIU") : null;

      let rawPeriod = null;
      for (let i = 0; i < bytes.length - 1; i++) {
        if (bytes[i] === 0x28) {
          const r = readVarint(bytes, i + 1);
          if (r.value >= 30000 && r.value <= 50000) {
            rawPeriod = r.value;
            break;
          }
        }
      }

      const entry = {
        time: new Date().toISOString(),
        dice: [d1, d2, d3],
        sum,
        result,
        period: rawPeriod,
        nextPeriod: rawPeriod != null ? rawPeriod + 1 : null
      };

      results.unshift(entry);
      if (results.length > 100) results.pop();

      console.log(`[KẾT QUẢ] Phiên #${entry.period} | 🎲 ${entry.dice.join('-')} | Tổng ${entry.sum} | ${entry.result}`);
    } catch (err) {
      console.error("[WS ERROR]", err.message);
    }
  });

  ws.on("error", (err) => console.error("[WS ERROR]", err.message));

  ws.on("close", () => {
    console.log("[WS] Mất kết nối, reconnect sau 3s...");
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    setTimeout(connect, 3000);
  });
}

function getResults() { return results; }

module.exports = { connect, getResults };
