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

환경 변수를 지정하지 않으면 기본 입장코드는 `blackcode`입니다. 프론트엔드는 입장코드를 하드코딩해서 검사하지 않고, 서버의 `/api/blackcheck/access` API로 검증합니다.

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

데이터는 기본적으로 `blackcheck-platform/data/comments.json` 파일에 저장됩니다. 운영 환경에서는 `BLACKCHECK_DATA_FILE`로 저장 경로를 바꿀 수 있습니다.

`MYSQL_HOST`를 설정하면 MySQL 모드로 동작합니다. 번호 조회 시 `gangnam_DB.bamcheat_comments`와 `mnms_prod.bamcheat_comments`를 함께 조회하고 최신순으로 합치며, 새 코멘트는 기존 `gangnam_DB`에만 저장합니다. `mnms_prod`에서 온 결과는 조회 전용입니다.

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=blackcheck
MYSQL_PASSWORD=secret
BLACKCHECK_AUTHOR_USER_ID=1
```

두 데이터베이스에서 동일한 테이블을 읽을 수 있는 MySQL 계정 권한이 필요합니다. 데이터베이스나 테이블 이름이 다른 환경에서는 `BLACKCHECK_PRIMARY_DATABASE`, `BLACKCHECK_SECONDARY_DATABASE`, `BLACKCHECK_COMMENTS_TABLE`로 변경할 수 있습니다.

## 권한 모델

- 회원가입/로그인 없이 입장코드만 입력하면 조회, 코멘트 등록, 추천을 이용할 수 있습니다.
- 코멘트와 추천은 접속한 입장코드를 해시한 식별자에 연결됩니다.
- 삭제는 관리자 토큰(`BLACKCHECK_ADMIN_TOKEN`)으로만 가능합니다.
- `BLACKCHECK_BUSINESS_TOKEN` 또는 `BLACKCHECK_ADMIN_TOKEN`을 Bearer 토큰으로 보내면 입장코드 없이도 API 접근이 가능합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `8000` | 독립 서버 포트 |
| `BLACKCHECK_ACCESS_CODE` | `blackcode` | 사용자가 입력해야 하는 입장코드(여러 개는 쉼표로 구분) |
| `BLACKCHECK_DATA_FILE` | `./data/comments.json` | 코멘트/추천 JSON 저장 파일 |
| `BLACKCHECK_BUSINESS_TOKEN` | 없음 | API용 기업회원 권한 Bearer 토큰 |
| `BLACKCHECK_ADMIN_TOKEN` | 없음 | API용 관리자 권한 Bearer 토큰 |
| `BLACKCHECK_CORS_ORIGIN` | `*` | 외부 프론트엔드에서 API만 호출할 때 허용할 Origin |
| `MYSQL_HOST` | 없음 | 설정 시 MySQL 이중 DB 조회 모드 활성화 |
| `MYSQL_PORT` | `3306` | MySQL 포트 |
| `MYSQL_USER` / `MYSQL_PASSWORD` | 없음 | 두 DB에 접근할 MySQL 인증 정보 |
| `BLACKCHECK_PRIMARY_DATABASE` | `gangnam_DB` | 조회 및 INSERT 대상 DB |
| `BLACKCHECK_SECONDARY_DATABASE` | `mnms_prod` | 조회 전용으로 함께 검색할 DB |
| `BLACKCHECK_COMMENTS_TABLE` | `bamcheat_comments` | 양쪽 DB의 코멘트 테이블명 |
| `BLACKCHECK_AUTHOR_USER_ID` | `1` | INSERT 시 사용할 기존 `users.id` |

## 프론트엔드 API 주소 변경

프론트엔드를 API 서버와 다른 도메인에서 호스팅해야 하면 `index.html`에서 `app.js`보다 먼저 아래 전역값을 선언하세요.

```html
<script>window.BLACKCHECK_API_PREFIX = 'https://api.example.com/api';</script>
```
