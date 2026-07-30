/**
 * Standalone Blackcheck API + static server.
 *
 * The folder can be copied out of the main repository and run after installing
 * its npm dependencies.
 */
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
const SEED_ACCESS_CODES = String(process.env.BLACKCHECK_ACCESS_CODE || '')
  .split(',')
  .map((code) => code.trim())
  .filter(Boolean);
const BUSINESS_TOKEN = String(process.env.BLACKCHECK_BUSINESS_TOKEN || '').trim();
const ADMIN_TOKEN = String(process.env.BLACKCHECK_ADMIN_TOKEN || '').trim();
const MAX_COMMENT_LENGTH = 1000;
const MYSQL_HOST = String(process.env.MYSQL_HOST || '').trim();
const MYSQL_DATABASE = String(process.env.MYSQL_DATABASE || 'gangnam_DB').trim();

function assertSqlIdentifier(value, name) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`${name} 환경 변수에 올바르지 않은 SQL 식별자가 있습니다.`);
}

assertSqlIdentifier(MYSQL_DATABASE, 'MYSQL_DATABASE');

const dbPool = mysql.createPool({
  host: MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  charset: 'utf8mb4'
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
  if (!MYSQL_HOST) throw new Error('MYSQL_HOST 환경 변수를 설정해주세요.');

  await dbPool.query(`CREATE DATABASE IF NOT EXISTS \`${MYSQL_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await dbPool.query(`CREATE TABLE IF NOT EXISTS \`${MYSQL_DATABASE}\`.blackcheck_access_codes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    access_code VARCHAR(255) NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    enabled BOOLEAN NOT NULL DEFAULT TRUE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  // Older releases stored only a one-way hash. Keep that column for schema
  // compatibility, but stop using it and add the plain access-code column.
  const [accessCodeColumns] = await dbPool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'blackcheck_access_codes'`,
    [MYSQL_DATABASE]
  );
  const accessCodeColumnNames = new Set(accessCodeColumns.map((column) => column.COLUMN_NAME));
  if (!accessCodeColumnNames.has('access_code')) {
    await dbPool.query(`ALTER TABLE \`${MYSQL_DATABASE}\`.blackcheck_access_codes ADD COLUMN access_code VARCHAR(255) NULL UNIQUE AFTER id`);
  }
  if (accessCodeColumnNames.has('code_hash')) {
    await dbPool.query(`ALTER TABLE \`${MYSQL_DATABASE}\`.blackcheck_access_codes MODIFY COLUMN code_hash CHAR(64) NULL`);
  }
  await dbPool.query(`CREATE TABLE IF NOT EXISTS \`${MYSQL_DATABASE}\`.bamcheat_comments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    phone_number VARCHAR(11) NOT NULL,
    author_user_id VARCHAR(80) NOT NULL,
    region VARCHAR(50) NOT NULL,
    district VARCHAR(50) NOT NULL,
    comment VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_comments_phone_created (phone_number, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await dbPool.query(`CREATE TABLE IF NOT EXISTS \`${MYSQL_DATABASE}\`.bamcheat_recommendations (
    comment_id BIGINT UNSIGNED NOT NULL,
    user_id VARCHAR(80) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (comment_id, user_id),
    CONSTRAINT fk_recommendation_comment FOREIGN KEY (comment_id)
      REFERENCES bamcheat_comments(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  for (const accessCode of SEED_ACCESS_CODES) {
    await dbPool.execute(
      `INSERT IGNORE INTO \`${MYSQL_DATABASE}\`.blackcheck_access_codes (access_code) VALUES (?)`,
      [accessCode]
    );
  }
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
  const [rows] = accessCode
    ? await dbPool.execute(`SELECT id FROM \`${MYSQL_DATABASE}\`.blackcheck_access_codes WHERE access_code = ? AND enabled = TRUE LIMIT 1`, [accessCode])
    : [[]];
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
    createdAt: comment.createdAt,
    recommendationCount: Number(comment.recommendationCount || 0),
    isRecommendedByMe: Boolean(comment.isRecommendedByMe),
    sourceDatabase: MYSQL_DATABASE,
    readOnly: false
  };
}

function databaseComment(row) {
  return {
    id: String(row.id),
    phoneNumber: row.phone_number,
    authorUserId: row.author_user_id,
    region: row.region,
    district: row.district,
    comment: row.comment,
    createdAt: row.created_at,
    recommendationCount: row.recommendation_count,
    isRecommendedByMe: Boolean(row.is_recommended_by_me)
  };
}

async function readDatabaseComments(phoneNumber, viewerId) {
  const sql = `SELECT c.id, c.phone_number, c.author_user_id, c.region, c.district, c.comment, c.created_at,
    COUNT(r.user_id) AS recommendation_count,
    MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) AS is_recommended_by_me
    FROM \`${MYSQL_DATABASE}\`.bamcheat_comments c
    LEFT JOIN \`${MYSQL_DATABASE}\`.bamcheat_recommendations r ON r.comment_id = c.id
    WHERE c.phone_number = ?
    GROUP BY c.id, c.phone_number, c.author_user_id, c.region, c.district, c.comment, c.created_at
    ORDER BY c.created_at DESC`;
  const [rows] = await dbPool.execute(sql, [viewerId, phoneNumber]);
  return rows.map(databaseComment);
}

async function createDatabaseComment({ phoneNumber, authorUserId, region, district, comment }) {
  const sql = `INSERT INTO \`${MYSQL_DATABASE}\`.bamcheat_comments (phone_number, author_user_id, region, district, comment) VALUES (?, ?, ?, ?, ?)`;
  const [result] = await dbPool.execute(sql, [phoneNumber, authorUserId, region, district, comment]);
  const [rows] = await dbPool.execute(`SELECT id, phone_number, author_user_id, region, district, comment, created_at FROM \`${MYSQL_DATABASE}\`.bamcheat_comments WHERE id = ?`, [result.insertId]);
  return databaseComment(rows[0]);
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
    const comments = (await readDatabaseComments(phoneNumber, viewer.id)).map(mapComment);
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

    const createdComment = await createDatabaseComment({ phoneNumber, authorUserId: viewer.id, region, district, comment: commentText });
    sendJson(res, 201, { comment: mapComment(createdComment) });
    return;
  }

  const recommendMatch = url.pathname.match(/^\/api\/bamcheat\/comments\/([^/]+)\/recommend$/);
  if (req.method === 'POST' && recommendMatch) {
    if (!assertCanWrite(res, viewer)) return;
    const commentId = decodeURIComponent(recommendMatch[1]);
    if (!/^\d+$/.test(commentId)) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
    const [comments] = await dbPool.execute(`SELECT id FROM \`${MYSQL_DATABASE}\`.bamcheat_comments WHERE id = ?`, [commentId]);
    if (!comments.length) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
    const [existing] = await dbPool.execute(`SELECT comment_id FROM \`${MYSQL_DATABASE}\`.bamcheat_recommendations WHERE comment_id = ? AND user_id = ?`, [commentId, viewer.id]);
    const isRecommendedByMe = existing.length === 0;
    if (isRecommendedByMe) {
      await dbPool.execute(`INSERT INTO \`${MYSQL_DATABASE}\`.bamcheat_recommendations (comment_id, user_id) VALUES (?, ?)`, [commentId, viewer.id]);
    } else {
      await dbPool.execute(`DELETE FROM \`${MYSQL_DATABASE}\`.bamcheat_recommendations WHERE comment_id = ? AND user_id = ?`, [commentId, viewer.id]);
    }
    const [[countRow]] = await dbPool.execute(`SELECT COUNT(*) AS count FROM \`${MYSQL_DATABASE}\`.bamcheat_recommendations WHERE comment_id = ?`, [commentId]);
    const recommendationCount = Number(countRow.count);
    sendJson(res, 200, { recommendationCount, isRecommendedByMe });
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/bamcheat\/comments\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    if (viewer.role !== 'ADMIN') return sendError(res, 403, '관리자만 코멘트를 삭제할 수 있습니다.');
    const commentId = decodeURIComponent(deleteMatch[1]);
    if (!/^\d+$/.test(commentId)) return sendError(res, 404, '코멘트를 찾을 수 없습니다.');
    const [result] = await dbPool.execute(`DELETE FROM \`${MYSQL_DATABASE}\`.bamcheat_comments WHERE id = ?`, [commentId]);
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
    console.log(`MySQL database: ${MYSQL_DATABASE}`);
  });
}

start().catch((error) => {
  console.error(`서버 시작 실패: ${error.message}`);
  dbPool.end().finally(() => process.exit(1));
});
