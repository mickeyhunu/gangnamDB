/**
 * Standalone Blackcheck API + static server.
 *
 * The folder can be copied out of the main repository and run after installing
 * its npm dependencies.
 */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const mysql = require('mysql2/promise');

function loadEnvFile(filePath = path.join(__dirname, '.env')) {
  if (!fs.existsSync(filePath)) return;

  const entries = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const entry of entries) {
    const match = entry.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;

    let value = match[2] || '';
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 8000);
const ACCESS_CODES = String(process.env.BLACKCHECK_ACCESS_CODE || 'blackcode')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean);
const DATA_FILE = path.resolve(process.env.BLACKCHECK_DATA_FILE || path.join(__dirname, 'data', 'comments.json'));
const BUSINESS_TOKEN = String(process.env.BLACKCHECK_BUSINESS_TOKEN || '').trim();
const ADMIN_TOKEN = String(process.env.BLACKCHECK_ADMIN_TOKEN || '').trim();
const MAX_COMMENT_LENGTH = 1000;
const MYSQL_HOST = String(process.env.MYSQL_HOST || '').trim();
const PRIMARY_DATABASE = process.env.BLACKCHECK_PRIMARY_DATABASE || 'gangnam_DB';
const SECONDARY_DATABASE = process.env.BLACKCHECK_SECONDARY_DATABASE || 'mnms_prod';
const COMMENTS_TABLE = process.env.BLACKCHECK_COMMENTS_TABLE || 'bamcheat_comments';
const DEFAULT_AUTHOR_USER_ID = Number(process.env.BLACKCHECK_AUTHOR_USER_ID || 1);

function assertSqlIdentifier(value, name) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`${name} 환경 변수에 올바르지 않은 SQL 식별자가 있습니다.`);
}

assertSqlIdentifier(PRIMARY_DATABASE, 'BLACKCHECK_PRIMARY_DATABASE');
assertSqlIdentifier(SECONDARY_DATABASE, 'BLACKCHECK_SECONDARY_DATABASE');
assertSqlIdentifier(COMMENTS_TABLE, 'BLACKCHECK_COMMENTS_TABLE');

const dbPool = MYSQL_HOST ? mysql.createPool({
  host: MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  charset: 'utf8mb4'
}) : null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function ensureDataFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ comments: [], recommendations: [] }, null, 2));
  }
}

function readStore() {
  ensureDataFile();
  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return {
    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
  };
}

function writeStore(store) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': process.env.BLACKCHECK_CORS_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...getCorsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { message });
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error('요청 본문이 너무 큽니다.'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_error) {
        reject(new Error('JSON 형식이 올바르지 않습니다.'));
      }
    });
    req.on('error', reject);
  });
}

function normalizePhoneNumber(value) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, 11).trim();
}

function sanitizeComment(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s{3,}/g, '  ').trim().slice(0, MAX_COMMENT_LENGTH);
}

function resolveViewer(req, data = {}) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) return { id: 'admin', role: 'ADMIN', authenticated: true, privileged: true };
  if (BUSINESS_TOKEN && token === BUSINESS_TOKEN) return { id: 'business', role: 'BUSINESS', authenticated: true, privileged: true };
  const accessCode = String(data.accessCode || '').trim();
  return { id: accessCode ? `code:${crypto.createHash('sha256').update(accessCode).digest('hex').slice(0, 16)}` : 'guest', role: 'GUEST', authenticated: false, privileged: ACCESS_CODES.includes(accessCode) };
}

function assertCanAccess(res, viewer) {
  if (viewer.privileged) return true;
  sendError(res, 403, '콜체크 접근 코드가 필요합니다.');
  return false;
}

function assertCanWrite(res, viewer) {
  if (viewer.privileged) return true;
  sendError(res, 403, '유효한 입장코드가 필요합니다.');
  return false;
}

function mapComment(comment, store, viewer) {
  const recommendationCount = store.recommendations.filter((item) => item.commentId === comment.id).length;
  const isRecommendedByMe = store.recommendations.some((item) => item.commentId === comment.id && item.userId === viewer.id);
  return {
    id: comment.id,
    phoneNumber: comment.phoneNumber,
    authorUserId: comment.authorUserId,
    region: comment.region,
    district: comment.district,
    comment: comment.comment,
    createdAt: comment.createdAt,
    recommendationCount,
    isRecommendedByMe,
    sourceDatabase: comment.sourceDatabase,
    readOnly: Boolean(comment.readOnly)
  };
}

function databaseComment(row, database) {
  const id = `${database}:${row.id}`;
  return {
    id,
    phoneNumber: row.phone_number,
    authorUserId: row.author_user_id,
    region: row.region,
    district: row.district,
    comment: row.comment,
    createdAt: row.created_at,
    sourceDatabase: database,
    readOnly: database !== PRIMARY_DATABASE
  };
}

async function readDatabaseComments(phoneNumber) {
  const results = await Promise.all([PRIMARY_DATABASE, SECONDARY_DATABASE].map(async (database) => {
    const sql = `SELECT id, phone_number, author_user_id, region, district, comment, created_at FROM \`${database}\`.\`${COMMENTS_TABLE}\` WHERE phone_number = ?`;
    const [rows] = await dbPool.execute(sql, [phoneNumber]);
    return rows.map((row) => databaseComment(row, database));
  }));
  return results.flat();
}

async function createDatabaseComment({ phoneNumber, region, district, comment }) {
  if (!Number.isSafeInteger(DEFAULT_AUTHOR_USER_ID) || DEFAULT_AUTHOR_USER_ID < 1) throw new Error('BLACKCHECK_AUTHOR_USER_ID를 유효한 사용자 ID로 설정해주세요.');
  const sql = `INSERT INTO \`${PRIMARY_DATABASE}\`.\`${COMMENTS_TABLE}\` (phone_number, author_user_id, region, district, comment) VALUES (?, ?, ?, ?, ?)`;
  const [result] = await dbPool.execute(sql, [phoneNumber, DEFAULT_AUTHOR_USER_ID, region, district, comment]);
  const [rows] = await dbPool.execute(`SELECT id, phone_number, author_user_id, region, district, comment, created_at FROM \`${PRIMARY_DATABASE}\`.\`${COMMENTS_TABLE}\` WHERE id = ?`, [result.insertId]);
  return databaseComment(rows[0], PRIMARY_DATABASE);
}

async function handleApi(req, res, url) {
  const queryData = Object.fromEntries(url.searchParams.entries());
  const bodyData = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await getRequestBody(req) : {};
  const input = { ...queryData, ...bodyData };
  const viewer = resolveViewer(req, input);

  if (req.method === 'POST' && url.pathname === '/api/blackcheck/access') {
    if (!assertCanAccess(res, viewer)) return;
    sendJson(res, 200, { success: true, role: viewer.role });
    return;
  }

  if (!assertCanAccess(res, viewer)) return;

  if (req.method === 'GET' && url.pathname === '/api/bamcheat/comments') {
    const phoneNumber = normalizePhoneNumber(input.phoneNumber);
    if (!phoneNumber || phoneNumber.length < 7 || phoneNumber.length > 11) {
      sendError(res, 400, '검색할 번호를 7~11자리 숫자로 입력해주세요.');
      return;
    }
    const store = readStore();
    const sourceComments = dbPool ? await readDatabaseComments(phoneNumber) : store.comments.filter((comment) => comment.phoneNumber === phoneNumber);
    const comments = sourceComments
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((comment) => mapComment(comment, store, viewer));
    sendJson(res, 200, { phoneNumber, comments, hasComments: comments.length > 0 });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bamcheat/comments') {
    if (!assertCanWrite(res, viewer)) return;
    const phoneNumber = normalizePhoneNumber(input.phoneNumber);
    const region = String(input.region || '').trim().slice(0, 50);
    const district = String(input.district || '').trim().slice(0, 50);
    const commentText = sanitizeComment(input.comment);
    if (!phoneNumber || phoneNumber.length < 7 || phoneNumber.length > 11) return sendError(res, 400, '전화번호를 7~11자리 숫자로 입력해주세요.');
    if (!region) return sendError(res, 400, '활동 시/도를 선택해주세요.');
    if (!district) return sendError(res, 400, '활동 구/군을 선택해주세요.');
    if (!commentText) return sendError(res, 400, '코멘트를 입력해주세요.');

    const store = readStore();
    const createdComment = dbPool ? await createDatabaseComment({ phoneNumber, region, district, comment: commentText }) : {
      id: crypto.randomUUID(),
      phoneNumber,
      authorUserId: viewer.id,
      region,
      district,
      comment: commentText,
      createdAt: new Date().toISOString()
    };
    if (!dbPool) {
      store.comments.push(createdComment);
      writeStore(store);
    }
    sendJson(res, 201, { comment: mapComment(createdComment, store, viewer) });
    return;
  }

  const recommendMatch = url.pathname.match(/^\/api\/bamcheat\/comments\/([^/]+)\/recommend$/);
  if (req.method === 'POST' && recommendMatch) {
    if (!assertCanWrite(res, viewer)) return;
    const commentId = decodeURIComponent(recommendMatch[1]);
    if (commentId.startsWith(`${SECONDARY_DATABASE}:`)) return sendError(res, 403, '외부 데이터베이스의 코멘트는 조회만 가능합니다.');
    const store = readStore();
    if (!dbPool && !store.comments.some((comment) => comment.id === commentId)) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
    const existingIndex = store.recommendations.findIndex((item) => item.commentId === commentId && item.userId === viewer.id);
    let isRecommendedByMe = true;
    if (existingIndex >= 0) {
      store.recommendations.splice(existingIndex, 1);
      isRecommendedByMe = false;
    } else {
      store.recommendations.push({ commentId, userId: viewer.id, createdAt: new Date().toISOString() });
    }
    writeStore(store);
    const recommendationCount = store.recommendations.filter((item) => item.commentId === commentId).length;
    sendJson(res, 200, { recommendationCount, isRecommendedByMe });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/bamcheat\/comments\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    if (viewer.role !== 'ADMIN') return sendError(res, 403, '관리자만 코멘트를 삭제할 수 있습니다.');
    const commentId = decodeURIComponent(deleteMatch[1]);
    if (dbPool) {
      const prefix = `${PRIMARY_DATABASE}:`;
      if (!commentId.startsWith(prefix)) return sendError(res, 403, '외부 데이터베이스의 코멘트는 삭제할 수 없습니다.');
      const numericId = commentId.slice(prefix.length);
      if (!/^\d+$/.test(numericId)) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
      const [result] = await dbPool.execute(`DELETE FROM \`${PRIMARY_DATABASE}\`.\`${COMMENTS_TABLE}\` WHERE id = ?`, [numericId]);
      if (!result.affectedRows) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
      const store = readStore();
      store.recommendations = store.recommendations.filter((item) => item.commentId !== commentId);
      writeStore(store);
      sendJson(res, 200, { success: true });
      return;
    }
    const store = readStore();
    const beforeCount = store.comments.length;
    store.comments = store.comments.filter((comment) => comment.id !== commentId);
    store.recommendations = store.recommendations.filter((item) => item.commentId !== commentId);
    if (store.comments.length === beforeCount) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
    writeStore(store);
    sendJson(res, 200, { success: true });
    return;
  }

  sendError(res, 404, 'API 경로를 찾을 수 없습니다.');
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(__dirname, requestedPath));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, getCorsHeaders());
      res.end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendError(res, 500, error.message || '서버 오류가 발생했습니다.');
  }
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`Blackcheck platform is running at http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
