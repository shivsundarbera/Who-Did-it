"use strict";
// Who Did It: multiplayer lobby server. No dependencies, needs Node 18 or newer.
// Run with: node server.js
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const INDEX_FILE = path.join(__dirname, "index.html");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const MAX_ROOMS = 300;
const MAX_PLAYERS = 20;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

const rooms = new Map();

// Basic abuse protection for a public server: limit how many lobbies one address can create per hour.
const CREATE_LIMIT_PER_HOUR = 20;
const MAX_CLIENTS_PER_ROOM = 60;
const createLog = new Map();
function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}
function createAllowed(ip) {
  const now = Date.now();
  const recent = (createLog.get(ip) || []).filter((t) => now - t < 3600000);
  if (recent.length >= CREATE_LIMIT_PER_HOUR) { createLog.set(ip, recent); return false; }
  recent.push(now);
  createLog.set(ip, recent);
  return true;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(message, status) { throw new HttpError(status || 400, message); }

function newCode() {
  for (;;) {
    let c = "";
    for (let i = 0; i < 5; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
function newId() { return crypto.randomBytes(4).toString("hex"); }
function validToken(t) { return typeof t === "string" && /^[A-Za-z0-9]{16,64}$/.test(t); }
function cleanName(n) {
  if (typeof n !== "string") return "";
  return n.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20);
}
function cleanText(t) {
  if (typeof t !== "string") return "";
  return t.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}
function clampInt(v, min, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) fail("Numbers only.");
  return Math.max(min, Math.min(max, n));
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clearHelp(room) {
  if (room.helpTimer) clearTimeout(room.helpTimer);
  room.helpTimer = null;
  if (room.gameTimer) clearTimeout(room.gameTimer);
  room.gameTimer = null;
  room.gameEndsAt = null;
}
function endRound(room, winner, reason, accusedId, accuserId) {
  clearHelp(room);
  room.phase = "ended";
  room.winner = winner;
  room.endReason = reason;
  room.accusedId = accusedId || null;
  room.accuserId = accuserId || null;
}
function gameTimeUp(room) {
  room.gameTimer = null;
  if (room.phase === "playing") {
    endRound(room, "killers", "game-time", null, null);
    broadcast(room);
  }
}
function helpExpired(room) {
  return room.phase === "playing" && room.help && Date.now() >= room.help.endsAt;
}
function timeUp(room) {
  room.helpTimer = null;
  if (room.phase === "playing" && room.help) {
    endRound(room, "killers", "time-up", null, null);
    broadcast(room);
  }
}

// What one player is allowed to see. Roles stay on the server until the round ends.
function view(room, token) {
  const mine = room.players.find((p) => p.token === token) || null;
  const ended = room.phase === "ended";
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    target: room.target,
    killers: room.killers,
    police: room.police,
    isHost: token === room.hostToken,
    me: mine ? { id: mine.id, name: mine.name, role: room.phase === "lobby" ? null : mine.role, alive: mine.alive } : null,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, alive: p.alive, diedAt: p.diedAt, isMe: p.token === token,
      role: ended ? p.role : undefined
    })),
    winner: room.winner,
    accusedId: room.accusedId,
    accuserId: room.accuserId,
    endReason: room.endReason,
    helpSeconds: room.helpSeconds,
    gameSeconds: room.gameSeconds,
    gameEndsAt: room.phase === "playing" ? room.gameEndsAt : null,
    serverNow: Date.now(),
    help: room.help ? helpView(room, mine) : null
  };
}

// The help call is public, but who made it is not (the police stay secret).
// Messages are visible only to the police; each other player sees just their own.
const MAX_MESSAGES_PER_PLAYER = 5;
const MAX_MESSAGES_TOTAL = 150;
function helpView(room, mine) {
  const h = room.help;
  const own = mine ? h.messages.filter((m) => m.fromId === mine.id) : [];
  const out = {
    startedAt: h.startedAt,
    endsAt: h.endsAt,
    mine: own.map((m) => m.text),
    left: Math.max(0, MAX_MESSAGES_PER_PLAYER - own.length)
  };
  if (mine && mine.role === "police" && room.phase === "playing") {
    out.messages = h.messages.map((m) => ({ id: m.id, fromId: m.fromId, text: m.text, at: m.at }));
  }
  return out;
}

function broadcast(room) {
  room.touched = Date.now();
  for (const c of room.clients) {
    try { c.res.write("event: state\ndata: " + JSON.stringify(view(room, c.token)) + "\n\n"); } catch (e) { /* dropped client */ }
  }
}

function resetToLobby(room, clear) {
  clearHelp(room);
  room.help = null;
  if (clear) room.players = [];
  else room.players.forEach((p) => { p.role = null; p.alive = true; p.diedAt = null; });
  room.phase = "lobby";
  room.winner = null; room.accusedId = null; room.accuserId = null; room.endReason = null;
}

function applyAction(room, action, token, body) {
  const isHost = token === room.hostToken;
  const needHost = () => { if (!isHost) fail("Only the host can do that.", 403); };
  const mine = room.players.find((p) => p.token === token) || null;

  switch (action) {
    case "join": {
      if (room.phase !== "lobby") fail("The game already started. Wait for the next round.");
      if (mine) fail("You already joined.");
      const name = cleanName(body.name);
      if (!name) fail("Type a name first.");
      if (room.players.length >= room.target) fail("The lobby is full.");
      if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail("That name is already taken. Pick another.");
      room.players.push({ id: newId(), token, name, role: null, alive: true, diedAt: null, joinedAt: Date.now() });
      break;
    }
    case "leave": {
      if (room.phase !== "lobby") fail("You can only leave from the lobby.");
      room.players = room.players.filter((p) => p.token !== token);
      break;
    }
    case "kick": {
      needHost();
      if (room.phase !== "lobby") fail("You can only remove players from the lobby.");
      room.players = room.players.filter((p) => p.id !== body.playerId);
      break;
    }
    case "config": {
      needHost();
      if (room.phase !== "lobby") fail("Settings can only change in the lobby.");
      const target = clampInt(body.target, 3, MAX_PLAYERS);
      const killers = clampInt(body.killers, 1, MAX_PLAYERS);
      const police = clampInt(body.police, 1, MAX_PLAYERS);
      if (target < room.players.length) fail("Players wanted cannot be fewer than players already joined.");
      if (killers + police > target - 1) fail("Killers plus police must leave room for at least one citizen.");
      let helpSeconds = room.helpSeconds;
      if (body.helpSeconds !== undefined) helpSeconds = clampInt(body.helpSeconds, 30, 300);
      let gameSeconds = room.gameSeconds;
      if (body.gameSeconds !== undefined) gameSeconds = body.gameSeconds === 0 ? 0 : clampInt(body.gameSeconds, 60, 3600);
      room.target = target; room.killers = killers; room.police = police; room.helpSeconds = helpSeconds; room.gameSeconds = gameSeconds;
      break;
    }
    case "start": {
      needHost();
      if (room.phase !== "lobby") fail("The game already started.");
      const n = room.players.length;
      if (n < 3) fail("Need at least 3 players to start.");
      if (room.killers + room.police >= n) fail("Too many killers and police for " + n + " players.");
      const order = shuffle(room.players.slice());
      order.forEach((p, i) => {
        p.role = i < room.killers ? "killer" : (i < room.killers + room.police ? "police" : "citizen");
        p.alive = true; p.diedAt = null;
      });
      clearHelp(room);
      room.help = null;
      room.round += 1;
      room.phase = "playing";
      if (room.gameSeconds > 0) {
        room.gameEndsAt = Date.now() + room.gameSeconds * 1000;
        room.gameTimer = setTimeout(() => gameTimeUp(room), room.gameSeconds * 1000 + 100);
      }
      room.winner = null; room.accusedId = null; room.accuserId = null; room.endReason = null;
      break;
    }
    case "dead": {
      if (room.phase !== "playing") fail("No round is running.");
      if (!mine || mine.role !== "citizen") fail("Only citizens have that button.", 403);
      if (!mine.alive) fail("You are already out.");
      mine.alive = false; mine.diedAt = Date.now();
      // Only police and killers left alive: the killers win.
      if (!room.players.some((p) => p.role === "citizen" && p.alive)) {
        endRound(room, "killers", "no-citizens", null, null);
      }
      break;
    }
    case "help": {
      if (room.phase !== "playing") fail("No round is running.");
      if (!mine || mine.role !== "police") fail("Only the police can ask for help.", 403);
      if (room.help) fail("You already asked for help this round.");
      const now = Date.now();
      room.help = { startedAt: now, endsAt: now + room.helpSeconds * 1000, messages: [] };
      room.helpTimer = setTimeout(() => timeUp(room), room.helpSeconds * 1000 + 100);
      break;
    }
    case "advise": {
      if (room.phase !== "playing" || !room.help) fail("The police have not asked for help.");
      if (helpExpired(room)) fail("Time is up.");
      if (!mine || !mine.alive) fail("Only living players can send advice.", 403);
      if (mine.role === "police") fail("Police receive advice, they do not send it.", 403);
      const text = cleanText(body.text);
      if (!text) fail("Type a message first.");
      if (room.help.messages.filter((m) => m.fromId === mine.id).length >= MAX_MESSAGES_PER_PLAYER) fail("You have used all " + MAX_MESSAGES_PER_PLAYER + " messages.");
      if (room.help.messages.length >= MAX_MESSAGES_TOTAL) fail("The police inbox is full.");
      room.help.messages.push({ id: newId(), fromId: mine.id, text, at: Date.now() });
      break;
    }
    case "accuse": {
      if (room.phase !== "playing") fail("No round is running.");
      if (!mine || mine.role !== "police") fail("Only police can accuse.", 403);
      const target = room.players.find((p) => p.id === body.targetId);
      if (!target || target.id === mine.id) fail("Pick another player.");
      if (helpExpired(room)) fail("Time is up.");
      endRound(room, target.role === "killer" ? "town" : "killers", "accused", target.id, mine.id);
      break;
    }
    case "lobby": {
      needHost();
      if (room.phase === "lobby") fail("Already in the lobby.");
      resetToLobby(room, body.mode === "clear");
      break;
    }
    default:
      fail("Unknown action.", 404);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 10000) { reject(new HttpError(413, "Request too large.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(new HttpError(400, "Bad JSON.")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}

function sendIndex(res) {
  fs.readFile(INDEX_FILE, (err, buf) => {
    if (err) { res.writeHead(500); res.end("index.html is missing"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    if (req.method === "GET" && (p === "/" || /^\/r\/[A-Za-z0-9]{3,10}\/?$/.test(p))) return sendIndex(res);
    if (req.method === "GET" && p === "/healthz") return sendJson(res, 200, { ok: true });

    if (req.method === "POST" && p === "/api/create") {
      const body = await readBody(req);
      if (!validToken(body.token)) fail("Bad token.");
      if (!createAllowed(clientIp(req))) fail("Too many lobbies created from your network. Try again in an hour.", 429);
      if (rooms.size >= MAX_ROOMS) fail("The server is busy. Try again later.", 503);
      const room = {
        code: newCode(), hostToken: body.token, phase: "lobby", round: 0,
        target: 6, killers: 1, police: 1, players: [], clients: new Set(),
        winner: null, accusedId: null, accuserId: null, endReason: null,
        helpSeconds: 120, gameSeconds: 0, gameEndsAt: null, gameTimer: null, help: null, helpTimer: null, touched: Date.now()
      };
      rooms.set(room.code, room);
      return sendJson(res, 200, { code: room.code });
    }

    const m = p.match(/^\/api\/room\/([A-Za-z0-9]{3,10})\/([a-z]+)$/);
    if (m) {
      const room = rooms.get(m[1].toUpperCase());
      if (!room) fail("Lobby not found. Check the link or code.", 404);
      const action = m[2];

      if (req.method === "GET" && (action === "state" || action === "events")) {
        const token = url.searchParams.get("token");
        if (!validToken(token)) fail("Bad token.");
        if (action === "state") return sendJson(res, 200, view(room, token));
        if (room.clients.size >= MAX_CLIENTS_PER_ROOM) fail("This lobby has too many connections.", 503);
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no"
        });
        const client = { res, token };
        room.clients.add(client);
        room.touched = Date.now();
        res.write("retry: 2000\n\nevent: state\ndata: " + JSON.stringify(view(room, token)) + "\n\n");
        req.on("close", () => room.clients.delete(client));
        return;
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        if (!validToken(body.token)) fail("Bad token.");
        applyAction(room, action, body.token, body);
        broadcast(room);
        return sendJson(res, 200, { ok: true, state: view(room, body.token) });
      }
    }

    fail("Not found.", 404);
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch (x) { /* closed */ } return; }
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: "Server error." });
  }
});

setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of room.clients) { try { c.res.write(": ping\n\n"); } catch (e) { room.clients.delete(c); } }
  }
}, 20000).unref();

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of createLog) {
    if (!times.some((t) => now - t < 3600000)) createLog.delete(ip);
  }
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && now - room.touched > ROOM_TTL_MS) { clearHelp(room); rooms.delete(code); }
  }
}, 10 * 60 * 1000).unref();

server.listen(PORT, "0.0.0.0", () => {
  console.log("Who Did It is running.");
  console.log("  On this computer:  http://localhost:" + PORT);
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((n) => {
      if (n.family === "IPv4" && !n.internal) console.log("  Same Wi-Fi (" + name + "):  http://" + n.address + ":" + PORT);
    });
  });
});

module.exports = server;
