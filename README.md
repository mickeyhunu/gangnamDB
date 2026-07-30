# 콜체크 독립 플랫폼

밤치트 페이지의 핵심 기능(입장코드, 번호 검색, 지역별 코멘트 작성, 추천, 관리자 삭제)을 독립적인 최상단 폴더로 복제한 풀스택 플랫폼입니다. 이 폴더만 따로 복사해도 정적 프론트엔드와 API 서버를 함께 실행할 수 있습니다.

## 실행

```bash
cd blackcheck-platform
npm start
```

기본 실행 주소는 `http://localhost:8000`이며, API는 같은 서버의 `/api/*` 경로로 제공됩니다. 실행할 때 프로젝트 루트의 `.env` 파일을 자동으로 읽으며, 셸에서 직접 지정한 환경 변수는 `.env`보다 우선합니다.

## 입장코드 설정

입장코드는 서버 환경 변수로 지정합니다.

```bash
BLACKCHECK_ACCESS_CODE='원하는입장코드' npm start
```

프론트엔드는 입장코드를 하드코딩해서 검사하지 않고, 서버의 `/api/blackcheck/access` API로 검증합니다. 서버가 시작될 때 `BLACKCHECK_ACCESS_CODE` 값은 SHA-256 해시로 DB에 등록되며, 이후 검증도 DB에 저장된 코드를 기준으로 합니다. 기존 코드는 환경 변수에서 제거해도 DB에 유지되고, 비활성화하려면 `blackcheck_access_codes.enabled`를 변경하면 됩니다.

여러 입장코드를 허용하려면 쉼표로 구분해서 설정할 수 있습니다.

```dotenv
BLACKCHECK_ACCESS_CODE=첫번째코드,두번째코드
```

## 포함된 API

- `POST /api/blackcheck/access` — 입장코드 검증
- `GET /api/bamcheat/comments?phoneNumber=01012345678&accessCode=입장코드`
- `POST /api/bamcheat/comments`
- `POST /api/bamcheat/comments/:commentId/recommend`
- `DELETE /api/bamcheat/comments/:commentId`

입장코드, 코멘트, 추천 데이터는 모두 MySQL에 저장됩니다. 서버 시작 시 데이터베이스와 `blackcheck_access_codes`, `bamcheat_comments`, `bamcheat_recommendations` 테이블이 없으면 자동으로 생성합니다. DB 접속이나 초기화에 실패하면 파일 저장 방식으로 대체하지 않고 서버 시작을 중단합니다.

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
