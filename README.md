# 콜체크 독립 플랫폼

밤치트 페이지의 핵심 기능(입장코드, 번호 검색, 지역별 코멘트 작성, 추천, 관리자 삭제)을 독립적인 최상단 폴더로 복제한 풀스택 플랫폼입니다. 이 폴더만 따로 복사해도 정적 프론트엔드와 API 서버를 함께 실행할 수 있습니다.

## 실행

```bash
cd blackcheck-platform
npm start
```

기본 실행 주소는 `http://localhost:8000`이며, API는 같은 서버의 `/api/*` 경로로 제공됩니다. 실행할 때 프로젝트 루트의 `.env` 파일을 자동으로 읽으며, 셸에서 직접 지정한 환경 변수는 `.env`보다 우선합니다.

## 입장코드 설정

입장 가능 여부는 `gangnam_DB.blackcheck_access_codes` 테이블에 저장된 활성 코드로만 판정합니다. 해시나 별도의 복호화 과정 없이 사용할 입장코드 원문을 바로 등록합니다.

```sql
INSERT INTO gangnam_DB.blackcheck_access_codes (access_code) VALUES ('원하는입장코드');
```

프론트엔드는 입장코드를 하드코딩해서 검사하지 않고 서버의 `/api/blackcheck/access` API로 검증합니다. 브라우저에 저장된 코드도 페이지를 다시 열 때 DB에서 재검증하므로, `enabled`를 `FALSE`로 바꾸면 기존 사용자도 더 이상 입장할 수 없습니다.

초기 배포 시에만 환경 변수로 코드를 등록하려면 쉼표로 구분한 `BLACKCHECK_ACCESS_CODE`를 사용할 수 있습니다. 서버가 각 코드를 같은 DB 테이블에 `INSERT IGNORE`하며, 실제 입장 검증은 항상 DB를 조회합니다.

```dotenv
BLACKCHECK_ACCESS_CODE=첫번째코드,두번째코드
```

## 포함된 API

- `POST /api/blackcheck/access` — 입장코드 검증
- `GET /api/bamcheat/comments?phoneNumber=01012345678&accessCode=입장코드`
- `POST /api/bamcheat/comments`
- `POST /api/bamcheat/comments/:commentId/recommend`
- `DELETE /api/bamcheat/comments/:commentId`

입장코드, 코멘트, 추천 데이터는 모두 MySQL에 저장됩니다. 서버 시작 시 데이터베이스와 `blackcheck_access_codes`, `bamcheat_comments`, `bamcheat_recommendations` 테이블이 없으면 자동으로 생성합니다. 이전 버전의 `code_hash` 컬럼만 있는 DB에는 `access_code` 컬럼을 자동으로 추가하며, 기존 해시는 원문으로 되돌릴 수 없으므로 사용할 코드를 `access_code`에 다시 등록해야 합니다. DB 접속이나 초기화에 실패하면 파일 저장 방식으로 대체하지 않고 서버 시작을 중단합니다.

```dotenv
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=gangnam_DB
BLACKCHECK_ACCESS_CODE=qwerasdf12,mastercode,password
```

MySQL 계정에는 데이터베이스와 테이블을 생성하고 읽고 쓸 권한이 필요합니다. 운영을 시작한 뒤 입장코드를 추가하려면 `BLACKCHECK_ACCESS_CODE`에 코드를 추가하고 서버를 재시작하면 기존 코드는 보존한 채 새 코드만 등록됩니다.

## 권한 모델

- 회원가입/로그인 없이 입장코드만 입력하면 조회, 코멘트 등록, 추천을 이용할 수 있습니다.
- 코멘트와 추천은 접속한 입장코드를 해시한 식별자에 연결됩니다.
- 삭제는 관리자 토큰(`BLACKCHECK_ADMIN_TOKEN`)으로만 가능합니다.
- `BLACKCHECK_BUSINESS_TOKEN` 또는 `BLACKCHECK_ADMIN_TOKEN`을 Bearer 토큰으로 보내면 입장코드 없이도 API 접근이 가능합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `8000` | 독립 서버 포트 |
| `BLACKCHECK_ACCESS_CODE` | 없음 | 시작 시 DB에 등록할 입장코드(여러 개는 쉼표로 구분) |
| `BLACKCHECK_BUSINESS_TOKEN` | 없음 | API용 기업회원 권한 Bearer 토큰 |
| `BLACKCHECK_ADMIN_TOKEN` | 없음 | API용 관리자 권한 Bearer 토큰 |
| `BLACKCHECK_CORS_ORIGIN` | `*` | 외부 프론트엔드에서 API만 호출할 때 허용할 Origin |
| `MYSQL_HOST` | 없음(필수) | MySQL 서버 주소 |
| `MYSQL_PORT` | `3306` | MySQL 포트 |
| `MYSQL_USER` / `MYSQL_PASSWORD` | 없음 | MySQL 인증 정보 |
| `MYSQL_DATABASE` | `gangnam_DB` | 자동 초기화하고 사용할 DB |

## 프론트엔드 API 주소 변경

프론트엔드를 API 서버와 다른 도메인에서 호스팅해야 하면 `index.html`에서 `app.js`보다 먼저 아래 전역값을 선언하세요.

```html
<script>window.BLACKCHECK_API_PREFIX = 'https://api.example.com/api';</script>
```
