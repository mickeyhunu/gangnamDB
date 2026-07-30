# 콜체크 독립 플랫폼

밤치트 페이지의 핵심 기능(입장코드, 번호 검색, 지역별 코멘트 작성, 추천, 관리자 삭제)을 독립적인 최상단 폴더로 복제한 풀스택 플랫폼입니다. 이 폴더만 따로 복사해도 정적 프론트엔드와 API 서버를 함께 실행할 수 있습니다.

## 실행

```bash
cd blackcheck-platform
npm start
```

기본 실행 주소는 `http://localhost:8000`이며, API는 같은 서버의 `/api/*` 경로로 제공됩니다. 실행할 때 프로젝트 루트의 `.env` 파일을 자동으로 읽으며, 셸에서 직접 지정한 환경 변수는 `.env`보다 우선합니다.

## MySQL 설정

코멘트, 추천, 입장코드는 모두 MySQL에 저장됩니다. 먼저 빈 데이터베이스를 만들고 다음 환경 변수를 설정하세요. 테이블은 서버 시작 시 자동 생성됩니다.

```dotenv
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=blackcheck
MYSQL_PASSWORD=비밀번호
MYSQL_DATABASE=gangnam_DB
```

기존 `.env`의 입장코드 `qwerasdf12`, `mastercode`, `password`는 최초 실행 때 `access_codes` 테이블에 SHA-256 해시로 자동 등록되며, 이후 검증도 이 테이블을 조회합니다. 평문 입장코드는 데이터베이스에 저장하지 않습니다.

추가 코드를 최초 등록해야 하는 경우에만 `BLACKCHECK_ACCESS_CODE`를 일시적으로 지정할 수 있습니다. 등록 후에는 환경 변수에서 제거해도 됩니다.

```dotenv
BLACKCHECK_ACCESS_CODE=첫번째코드,두번째코드
```

## 포함된 API

- `POST /api/blackcheck/access` — 입장코드 검증
- `GET /api/bamcheat/comments?phoneNumber=01012345678&accessCode=입장코드`
- `POST /api/bamcheat/comments`
- `POST /api/bamcheat/comments/:commentId/recommend`
- `DELETE /api/bamcheat/comments/:commentId`

데이터는 `comments`, `recommendations`, `access_codes` MySQL 테이블에 저장됩니다.

## 권한 모델

- 회원가입/로그인 없이 입장코드만 입력하면 조회, 코멘트 등록, 추천을 이용할 수 있습니다.
- 코멘트와 추천은 접속한 입장코드를 해시한 식별자에 연결됩니다.
- 삭제는 관리자 토큰(`BLACKCHECK_ADMIN_TOKEN`)으로만 가능합니다.
- `BLACKCHECK_BUSINESS_TOKEN` 또는 `BLACKCHECK_ADMIN_TOKEN`을 Bearer 토큰으로 보내면 입장코드 없이도 API 접근이 가능합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `8000` | 독립 서버 포트 |
| `MYSQL_HOST` | 없음 | MySQL 서버 호스트 |
| `MYSQL_PORT` | `3306` | MySQL 서버 포트 |
| `MYSQL_USER` | 없음 | MySQL 사용자 |
| `MYSQL_PASSWORD` | 없음 | MySQL 비밀번호 |
| `MYSQL_DATABASE` | `gangnam_DB` | 사용할 MySQL 데이터베이스 |
| `BLACKCHECK_ACCESS_CODE` | 없음 | DB에 추가 등록할 입장코드(여러 개는 쉼표로 구분, 선택 사항) |
| `BLACKCHECK_BUSINESS_TOKEN` | 없음 | API용 기업회원 권한 Bearer 토큰 |
| `BLACKCHECK_ADMIN_TOKEN` | 없음 | API용 관리자 권한 Bearer 토큰 |
| `BLACKCHECK_CORS_ORIGIN` | `*` | 외부 프론트엔드에서 API만 호출할 때 허용할 Origin |

## 프론트엔드 API 주소 변경

프론트엔드를 API 서버와 다른 도메인에서 호스팅해야 하면 `index.html`에서 `app.js`보다 먼저 아래 전역값을 선언하세요.

```html
<script>window.BLACKCHECK_API_PREFIX = 'https://api.example.com/api';</script>
```
