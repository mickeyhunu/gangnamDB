/**
 * Standalone Blackcheck API + static server.
 *
 * MySQL is used for all persistent data so multiple server instances can share it.
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
const BUSINESS_TOKEN = String(process.env.BLACKCHECK_BUSINESS_TOKEN || '').trim();
const ADMIN_TOKEN = String(process.env.BLACKCHECK_ADMIN_TOKEN || '').trim();
const MAX_COMMENT_LENGTH = 1000;
const INITIAL_ACCESS_CODE_HASHES = [
  '0a5519dea7cb19df6ae9ea65c9c19da8802328dd2db0dcfa16a64d6f9880b90d',
  '6716f9d7b0e3c483c3c75b2afa8e9d136b3b2233198a8a89d428e8d4e94eb641',
  '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
];

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'gangnam_DB',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z'
});

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

async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS access_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    code_hash CHAR(64) NOT NULL UNIQUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS comments (
    id CHAR(36) NOT NULL PRIMARY KEY,
    phone_number VARCHAR(11) NOT NULL,
    author_user_id VARCHAR(80) NOT NULL,
    region VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    comment VARCHAR(1000) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_comments_phone_created (phone_number, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS recommendations (
    comment_id CHAR(36) NOT NULL,
    user_id VARCHAR(80) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (comment_id, user_id),
    CONSTRAINT fk_recommendations_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const legacyCodes = String(process.env.BLACKCHECK_ACCESS_CODE || '').split(',').map((code) => code.trim()).filter(Boolean);
  const hashes = [...new Set([...INITIAL_ACCESS_CODE_HASHES, ...legacyCodes.map(hashAccessCode)])];
  if (hashes.length) await pool.query('INSERT IGNORE INTO access_codes (code_hash) VALUES ?', [hashes.map((hash) => [hash])]);
}

function hashAccessCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
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

async function resolveViewer(req, data = {}) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) return { id: 'admin', role: 'ADMIN', authenticated: true, privileged: true };
  if (BUSINESS_TOKEN && token === BUSINESS_TOKEN) return { id: 'business', role: 'BUSINESS', authenticated: true, privileged: true };
  const accessCode = String(data.accessCode || '').trim();
  const codeHash = accessCode ? hashAccessCode(accessCode) : '';
  const [rows] = codeHash ? await pool.execute('SELECT id FROM access_codes WHERE code_hash = ? LIMIT 1', [codeHash]) : [[]];
  return { id: rows.length ? `code:${rows[0].id}` : 'guest', role: 'GUEST', authenticated: false, privileged: rows.length > 0 };
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

function mapComment(comment) {
  return {
    id: comment.id,
    phoneNumber: comment.phoneNumber,
    authorUserId: comment.authorUserId,
    region: comment.region,
    district: comment.district,
    comment: comment.comment,
    createdAt: comment.createdAt instanceof Date ? comment.createdAt.toISOString() : comment.createdAt,
    recommendationCount: Number(comment.recommendationCount || 0),
    isRecommendedByMe: Boolean(comment.isRecommendedByMe)
  };
}

async function handleApi(req, res, url) {
  const queryData = Object.fromEntries(url.searchParams.entries());
  const bodyData = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await getRequestBody(req) : {};
  const input = { ...queryData, ...bodyData };
  const viewer = await resolveViewer(req, input);

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
    const [rows] = await pool.execute(`SELECT c.id, c.phone_number AS phoneNumber,
      c.author_user_id AS authorUserId, c.region, c.district, c.comment, c.created_at AS createdAt,
      COUNT(r.user_id) AS recommendationCount,
      MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) AS isRecommendedByMe
      FROM comments c LEFT JOIN recommendations r ON r.comment_id = c.id
      WHERE c.phone_number = ? GROUP BY c.id ORDER BY c.created_at DESC`, [viewer.id, phoneNumber]);
    const comments = rows.map(mapComment);
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

    const createdComment = {
      id: crypto.randomUUID(),
      phoneNumber,
      authorUserId: viewer.id,
      region,
      district,
      comment: commentText,
      createdAt: new Date().toISOString()
    };
    await pool.execute(`INSERT INTO comments
      (id, phone_number, author_user_id, region, district, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [createdComment.id, phoneNumber, viewer.id, region, district, commentText, new Date(createdComment.createdAt)]);
    sendJson(res, 201, { comment: mapComment({ ...createdComment, recommendationCount: 0, isRecommendedByMe: false }) });
    return;
  }

  const recommendMatch = url.pathname.match(/^\/api\/bamcheat\/comments\/([^/]+)\/recommend$/);
  if (req.method === 'POST' && recommendMatch) {
    if (!assertCanWrite(res, viewer)) return;
    const commentId = decodeURIComponent(recommendMatch[1]);
    const [comments] = await pool.execute('SELECT id FROM comments WHERE id = ? LIMIT 1', [commentId]);
    if (!comments.length) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
    const [result] = await pool.execute('INSERT IGNORE INTO recommendations (comment_id, user_id) VALUES (?, ?)', [commentId, viewer.id]);
    const isRecommendedByMe = result.affectedRows > 0;
    if (!isRecommendedByMe) await pool.execute('DELETE FROM recommendations WHERE comment_id = ? AND user_id = ?', [commentId, viewer.id]);
    const [[countRow]] = await pool.execute('SELECT COUNT(*) AS recommendationCount FROM recommendations WHERE comment_id = ?', [commentId]);
    const recommendationCount = Number(countRow.recommendationCount);
    sendJson(res, 200, { recommendationCount, isRecommendedByMe });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/bamcheat\/comments\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    if (viewer.role !== 'ADMIN') return sendError(res, 403, '관리자만 코멘트를 삭제할 수 있습니다.');
    const commentId = decodeURIComponent(deleteMatch[1]);
    const [result] = await pool.execute('DELETE FROM comments WHERE id = ?', [commentId]);
    if (!result.affectedRows) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
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

async function start() {
  await initializeDatabase();
  server.listen(PORT, () => {
    console.log(`Blackcheck platform is running at http://localhost:${PORT}`);
    console.log(`MySQL database: ${process.env.MYSQL_DATABASE || 'gangnam_DB'}`);
  });
}

start().catch((error) => {
  console.error('Failed to initialize MySQL:', error.message);
  process.exit(1);
});
