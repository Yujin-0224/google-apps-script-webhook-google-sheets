# Telegram Bot + Google Sheets 입고 자동화 시스템

텔레그램으로 들어오는 파일 입고 알림을 Google Sheets 편성표와 연동해, 프로그램별 파일 입고 상태를 자동으로 기록하고 확인하는 자동화 프로젝트입니다.

처음에는 사람이 텔레그램 메시지를 보고 수동으로 편성표에 적는 방식이었는데, 메시지가 많아질수록 누락이나 중복 기록이 생길 수 있어 자동화 구조를 만들어 보았습니다.

## 주요 기능

- 텔레그램 입고 완료 메시지 수신
- Cloudflare Worker를 통한 Webhook 프록시 처리
- Google Apps Script에서 메시지 파싱 및 Google Sheets 기록
- 프로그램명, 회차, 파일명 기준 입고 상태 확인
- 중복 메시지 및 중복 파일 기록 방지
- 자동 매칭이 어려운 메시지는 검수 시트로 분리
- 대시보드 시트에서 완료, 입고중, 미입고, 확인필요 상태 확인

## 사용 기술

- Cloudflare Workers
- Google Apps Script
- Google Sheets
- Telegram Bot API
- JavaScript
- GitHub Pages

## 전체 구조

```text
Telegram
  -> Cloudflare Worker
  -> Google Apps Script Webhook
  -> Google Sheets
```

- **Telegram**: 외부 업체가 파일 입고 완료 메시지를 보내는 채널
- **Cloudflare Worker**: Telegram Webhook 요청을 받아 Apps Script로 전달
- **Google Apps Script**: 메시지 파싱, 중복 방지, 편성표 비교, 상태 갱신 처리
- **Google Sheets**: 운영자가 확인하는 편성표, 입고로그, 검수, 대시보드 역할

## 처리 흐름

1. 텔레그램 메시지에서 파일명, 경로, 발생시간을 추출합니다.
2. 이미 처리한 메시지인지 확인해 중복 처리를 막습니다.
3. 경로와 파일명을 기준으로 편성표의 프로그램명을 찾습니다.
4. 회차 정보를 기준으로 필요한 파일 개수를 계산합니다.
5. 필요한 파일이 모두 들어오면 입고 상태를 완료로 변경합니다.
6. 자동으로 판단하기 어려운 메시지는 미매칭 검수 시트에 기록합니다.

## Google Sheets 구성

- **편성표**: 프로그램별 회차, 입고 시간, 상태를 관리하는 시트
- **입고로그**: 텔레그램에서 수신한 메시지와 처리 결과를 저장하는 시트
- **미매칭검수**: 자동 매칭이 어려운 메시지를 운영자가 확인하는 시트
- **대시보드**: 전체 입고 상태를 요약해서 보는 시트
- **매핑규칙**: 프로그램명이 다르게 들어오는 경우를 처리하기 위한 규칙 시트

자세한 시트 구성은 [spreadsheet/README.md](spreadsheet/README.md)에 정리했습니다.

## 메시지 예시

```text
[완료]
파일명:24.mpg
경로:tvN/시리즈/영상/어서와~ 한국은 처음이지?/24.mpg
발생시간: 2026-05-10 09:02:00
```

## 자동화 시스템 기획서

회사에 자동화 시스템의 필요성과 처리 흐름을 설명하기 위해, GitHub Pages를 통해 PPT 형식의 웹 기획서를 구현했습니다.


https://yujin-0224.github.io/google-apps-script-webhook-google-sheets/


로컬에서 확인할 때는 아래 명령어를 사용할 수 있습니다.

```powershell
cd docs
python -m http.server 4173 --bind 127.0.0.1
```

브라우저에서 아래 주소를 열어 확인할 수 있습니다.

```text
http://127.0.0.1:4173/
```

## 폴더 구조

```text
apps-script/                  # Google Apps Script 코드
telegram-apps-script-proxy/   # Cloudflare Worker 프록시 코드
spreadsheet/                  # Google Sheets 구성 설명
docs/                         # 발표용 GitHub Pages 화면
```

## 배운 점

- Webhook 기반 자동화 흐름을 직접 구성해 볼 수 있었습니다.
- 서버를 따로 두지 않고 Cloudflare Workers와 Apps Script로 간단한 운영 자동화를 만들 수 있었습니다.
- 실제 운영 데이터는 예외가 많기 때문에, 자동 처리뿐 아니라 사람이 검수할 수 있는 구조가 필요하다는 점을 배웠습니다.
- API 토큰과 Webhook Secret은 코드에 직접 넣지 않고 별도 설정값으로 관리해야 한다는 점을 알게 되었습니다.

## 보안 주의

Telegram Bot Token, Webhook Secret, Google Apps Script 배포 URL 등은 공개 저장소에 올리지 않아야 합니다.
이미 노출된 토큰이 있다면 BotFather에서 재발급하거나 폐기한 뒤 다시 설정해야 합니다.
