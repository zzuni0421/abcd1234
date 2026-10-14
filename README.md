# 우리반.zip — 학급 전용 커뮤니티 스타터

정적 HTML/CSS/JS + Supabase Auth/Postgres/RLS로 구성한 Cloudflare Pages용 스타터입니다.

## 포함 기능
- 이메일/비밀번호 회원가입 및 로그인
- 학급 초대 코드로 학급 가입 (가입 코드는 DB RPC에서 검증)
- 게시글 작성/조회/삭제
- 댓글/대댓글 작성/조회/삭제
- 프로필 닉네임 수정
- 관리자 전용 공지 작성 및 회원 역할 관리 기반
- DB Row Level Security 정책

> 이 폴더는 기존 프로젝트에 덮어쓰지 말고, 먼저 별도 브랜치에서 파일을 병합하세요.
> 기존 프로젝트의 `index.html`, CSS, JS 구조와 충돌할 수 있으므로 기존 `index.html`을 백업한 뒤 필요한 파일만 복사하세요.

## 1. Supabase 설정
1. Supabase 프로젝트를 만들거나 기존 프로젝트를 선택합니다.
2. SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
3. Authentication > URL Configuration에서 사이트 URL과 허용 리디렉션 URL을 설정합니다.
4. Project Settings > API에서 Project URL과 publishable key(구형 프로젝트는 anon key)를 확인합니다.
5. `config.js`의 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`를 채웁니다.
   - publishable/anon 키는 브라우저에 노출되는 용도입니다.
   - `service_role` 또는 `sb_secret_...` 키는 절대 프런트엔드에 넣지 마세요.

## 2. 학급 및 초대 코드 준비
`schema.sql` 실행 후 SQL Editor에서 학급을 생성합니다. 아래 예시는 새 학급 하나를 만듭니다.

```sql
insert into public.classrooms (name, join_code)
values ('우리 반', 'CHANGE-THIS-CODE')
returning id;
```

`join_code`는 실제 배포 전에 충분히 길고 추측하기 어려운 값으로 변경하세요. 초대 코드는 학생들에게 개인 메시지 등 안전한 방법으로 전달하고, 공개 게시판에 올리지 마세요.
이 스타터는 초대 코드를 DB에 평문으로 저장하는 간단한 MVP 방식입니다. 운영 단계에서는 코드 해시 저장, 만료/사용 횟수 제한, 가입 승인 기능을 권장합니다.

## 3. 관리자 지정
회원가입 후 첫 계정으로 로그인하고, Supabase SQL Editor에서 해당 계정의 UUID를 확인합니다:
- Authentication > Users에서 User UID 복사
- 아래 SQL에서 UUID를 바꿔 실행

```sql
update public.profiles
set role = 'admin'
where id = 'REPLACE-WITH-AUTH-USER-UUID';
```

관리자 계정은 신뢰할 수 있는 담당자 계정만 지정하세요. 역할은 클라이언트에서 변경할 수 없도록 RLS 정책이 제한합니다.

## 4. 기존 GitHub 프로젝트에 넣기
1. GitHub에서 새 브랜치(예: `feature/uriban-zip`)를 만듭니다.
2. 이 폴더의 `index.html`, `styles.css`, `config.js`, `app.js`와 `supabase/schema.sql`을 프로젝트에 복사합니다.
3. 프로젝트가 이미 `index.html`을 사용한다면 덮어쓰기 전에 백업하고, 기존 페이지 구조에 맞게 합칩니다.
4. `config.js`의 설정값을 입력합니다.
5. 변경 사항을 커밋하고 Preview 배포로 테스트합니다.
6. 문제가 없을 때만 기본 브랜치에 병합합니다.

## 5. Cloudflare Pages 배포
- 기존 Pages 프로젝트가 GitHub에 연결되어 있다면, 연결된 저장소/브랜치에 커밋하면 자동 배포됩니다.
- 정적 사이트라 빌드가 필요 없다면 Build command는 비워두고, output directory는 사이트 파일이 있는 폴더(저장소 루트에 넣었다면 `/`)로 설정합니다.
- Cloudflare Pages의 Preview URL과 실제 사이트 URL을 Supabase Auth URL Configuration에 추가합니다.

## 6. 필수 테스트
- 로그인하지 않은 상태에서 게시글/댓글 데이터에 접근할 수 없는지 확인
- 잘못된 초대 코드로 학급 가입이 거부되는지 확인
- 초대 코드 없이 회원가입한 계정은 학급 게시판을 볼 수 없는지 확인
- 학생 계정이 관리자 역할을 바꿀 수 없는지 확인
- 다른 학생의 글을 삭제/수정할 수 없는지 확인
- 관리자 계정만 공지를 작성할 수 있는지 확인

## 보안 주의
- SQL RLS는 브라우저 UI와 별개로 DB에서 권한을 확인합니다.
- `service_role`/secret 키를 HTML, JS, GitHub에 절대 넣지 마세요.
- 학생 실명, 개인 연락처 등 불필요한 개인정보를 수집하지 마세요.
- 초대 코드만으로 완벽한 신원 확인이 되지는 않습니다. 코드 유출 시 재발급하세요.
