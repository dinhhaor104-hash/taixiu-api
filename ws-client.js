const WebSocket = require("ws");
const https = require("https");
const http = require("http");
const { HttpsProxyAgent } = require("https-proxy-agent");

const LOGON_URL = "https://ovgbhbgkndt0nk9sr.au.qnwxdhwica.com/logon";
const PROXY_URL = process.env.PROXY_URL || null; // e.g. http://user:pass@host:port

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

function fetchLogon() {
  return new Promise((resolve, reject) => {
    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://68gbvn88.bar",
        "Referer": "https://68gbvn88.bar/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    };
    if (PROXY_URL) options.agent = new HttpsProxyAgent(PROXY_URL);

    const req = https.request(LOGON_URL, options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          console.log("[LOGON RAW]", data.slice(0, 300));
          const json = JSON.parse(data);
          if (!json.data) throw new Error("No data: " + JSON.stringify(json));
          resolve(json.data);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function connect() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  try {
    console.log("[WS] Đang lấy server info...");
    const data = await fetchLogon();
    const wsUrl = `${data.server.host}:${data.server.port}`;
    const token = data.token;
    const clientVersion = "0a21481d746f92f8428e1b6deeb76fea";

    console.log(`[WS] Kết nối ${wsUrl}...`);

    const wsOptions = {
      headers: {
        "Origin": "https://68gbvn88.bar",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://68gbvn88.bar/"
      }
    };
    if (PROXY_URL) wsOptions.agent = new HttpsProxyAgent(PROXY_URL);
    const ws = new WebSocket(wsUrl, wsOptions);

    ws.on("open", () => {
      console.log("[WS] Đã kết nối, handshake...");

      // 1. Handshake
      const handshake = JSON.stringify({
        sys: { platform: "js-websocket", clientBuildNumber: "0.0.1", clientVersion }
      });
      const hsBuf = Buffer.alloc(4 + handshake.length);
      hsBuf[0] = 0x01;
      hsBuf.writeUInt16BE(handshake.length, 2);
      Buffer.from(handshake).copy(hsBuf, 4);
      ws.send(hsBuf);

      // 2. Heartbeat
      ws.send(hexToBytes("02000000"));

      // 3. Auth với token động
      const tokenHex = Buffer.from(token).toString("hex");
      const authBody = `080210ca011a40${tokenHex}4200`;
      const authPayload = `0400004d0101000108021${authBody.slice(1)}`;
      // Dùng hardcode auth vì token guest không đổi
      ws.send(hexToBytes("0400004d01010001080210ca011a40393461633035333762663330343362313932373236656238636464333361326361303065386561616664393134616236383266663034366662306661383738654200"));

      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(hexToBytes("02000000"));
      }, 15000);
    });

    ws.on("message", (data) => {
      try {
        const bytes = new Uint8Array(data);
        const ascii = toLooseAscii(bytes);
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
            if (r.value >= 30000 && r.value <= 50000) { rawPeriod = r.value; break; }
          }
        }

        const entry = { time: new Date().toISOString(), dice: [d1, d2, d3], sum, result, period: rawPeriod, nextPeriod: rawPeriod != null ? rawPeriod + 1 : null };
        results.unshift(entry);
        if (results.length > 100) results.pop();
        console.log(`[KẾT QUẢ] Phiên #${entry.period} | 🎲 ${entry.dice.join('-')} | Tổng ${entry.sum} | ${entry.result}`);
      } catch (err) {
        console.error("[WS ERROR]", err.message);
      }
    });

    ws.on("error", (err) => console.error("[WS ERROR]", err.message));
    ws.on("close", () => {
      console.log("[WS] Mất kết nối, reconnect sau 5s...");
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      setTimeout(connect, 5000);
    });

  } catch (err) {
    console.error("[LOGON ERROR]", err.message);
    setTimeout(connect, 5000);
  }
}

function getResults() { return results; }
module.exports = { connect, getResults };
