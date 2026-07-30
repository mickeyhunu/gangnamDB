# 콜체크 독립 플랫폼

밤치트 페이지의 핵심 기능(입장코드, 번호 검색, 지역별 코멘트 작성, 추천)을 독립적인 최상단 폴더로 복제한 풀스택 플랫폼입니다. 이 폴더만 따로 복사해도 정적 프론트엔드와 API 서버를 함께 실행할 수 있습니다.

## 실행

```bash
cd blackcheck-platform
npm start
```

기본 실행 주소는 `http://localhost:8000`이며, API는 같은 서버의 `/api/*` 경로로 제공됩니다. 실행할 때 프로젝트 루트의 `.env` 파일을 자동으로 읽으며, 셸에서 직접 지정한 환경 변수는 `.env`보다 우선합니다.

## 입장코드 설정

입장 가능 여부는 `gangnam_DB.blackcheck_access_codes` 테이블에 저장된 활성 코드로만 판정합니다. 서버를 처음 실행하면 기본 입장코드 `gangnamking`을 이 테이블에 자동 등록합니다.

```sql
INSERT INTO gangnam_DB.blackcheck_access_codes (access_code) VALUES ('추가입장코드');
```

프론트엔드는 입장코드를 하드코딩해서 검사하지 않고 서버의 `/api/blackcheck/access` API로 검증합니다. 브라우저에 저장된 코드도 페이지를 다시 열 때 DB에서 재검증하므로, `enabled`를 `FALSE`로 바꾸면 기존 사용자도 더 이상 입장할 수 없습니다.

## 포함된 API

- `POST /api/blackcheck/access` — 입장코드 검증
- `GET /api/bamcheat/comments?phoneNumber=01012345678&accessCode=입장코드`
- `POST /api/bamcheat/comments`
- `POST /api/bamcheat/comments/:commentId/recommend`

입장코드, 새 코멘트, 추천 데이터는 쓰기 DB(`MYSQL_DATABASE`, 기본값 `gangnam_DB`)에 저장됩니다. 번호를 조회할 때는 쓰기 DB의 `bamcheat_comments`와 조회 전용 DB(`READONLY_MYSQL_DATABASE`, 기본값 `mnms_DB`)의 `bamcheat_comments` 결과를 합쳐 최신순으로 반환합니다. 조회 전용 DB의 코멘트는 추천하거나 이 프로젝트에서 수정·삭제하지 않습니다.

서버 시작 시 쓰기 데이터베이스와 `blackcheck_access_codes`, `bamcheat_comments`, `bamcheat_recommendations` 테이블이 없으면 자동으로 생성합니다. 조회 전용 DB나 테이블은 자동 생성하지 않으므로 미리 존재해야 합니다. 이전 버전의 `code_hash` 컬럼만 있는 DB에는 `access_code` 컬럼을 자동으로 추가하며, 기존 해시는 원문으로 되돌릴 수 없으므로 사용할 코드를 `access_code`에 다시 등록해야 합니다. DB 접속이나 초기화에 실패하면 파일 저장 방식으로 대체하지 않고 서버 시작을 중단합니다.

```dotenv
MYSQL_HOST=
MYSQL_PORT=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=gangnam_DB
READONLY_MYSQL_DATABASE=mnms_DB
```

MySQL 계정에는 쓰기 DB의 데이터베이스와 테이블을 생성하고 읽고 쓸 권한 및 조회 전용 DB의 `bamcheat_comments`를 읽을 권한이 필요합니다. 운영을 시작한 뒤 입장코드를 추가하려면 `blackcheck_access_codes` 테이블에 직접 등록합니다.

## 권한 모델

- 회원가입/로그인 없이 입장코드만 입력하면 조회, 코멘트 등록, 추천을 이용할 수 있습니다.
- 코멘트와 추천은 접속한 입장코드의 DB 식별자에 연결됩니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `8000` | 독립 서버 포트 |
| `MYSQL_HOST` | 없음(필수) | MySQL 서버 주소 |
| `MYSQL_PORT` | `3306` | MySQL 포트 |
| `MYSQL_USER` / `MYSQL_PASSWORD` | 없음 | MySQL 인증 정보 |
| `MYSQL_DATABASE` | `gangnam_DB` | 자동 초기화하고 사용할 DB |
| `READONLY_MYSQL_DATABASE` | `mnms_DB` | 검색 결과에 함께 포함할 조회 전용 DB |

## 프론트엔드 API 주소 변경

프론트엔드를 API 서버와 다른 도메인에서 호스팅해야 하면 `index.html`에서 `app.js`보다 먼저 아래 전역값을 선언하세요.

```html
<script>window.BLACKCHECK_API_PREFIX = 'https://api.example.com/api';</script>
```
