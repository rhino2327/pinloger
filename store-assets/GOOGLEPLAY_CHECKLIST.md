# Google Play 스토어 제출 체크리스트

## ✅ 완료된 것

- [x] 안드로이드 아이콘 safe zone 적용 (adaptive-icon-android.png, 60% 크기)
- [x] app.json 안드로이드 아이콘 분리 설정
- [x] eas.json 안드로이드 제출 설정
- [x] 앱 설명 (한국어/영어) 작성
- [x] 개인정보 처리방침 HTML 작성

## ⏳ Google Play 등록 전 해야 할 것

### 1. Google Play 개발자 계정 등록 (1회)
- **비용:** $25 (1회성, 평생)
- **URL:** https://play.google.com/console
- Google 계정으로 등록 → $25 결제 → 승인 (보통 즉시)

### 2. Google Play Console에서 앱 생성
1. Play Console → 앱 만들기
2. 앱 이름: PINLOGER
3. 기본 언어: 한국어
4. 앱 또는 게임: 앱
5. 무료 또는 유료: 무료

### 3. Google Play API 서비스 계정 키 발급 (EAS 자동 제출용)
1. Google Play Console → 설정 → API 액세스
2. Google Cloud Console에서 서비스 계정 생성
3. 역할: 릴리스 관리자
4. JSON 키 다운로드 → `store-assets/google-play-service-account.json`으로 저장
   ⚠️ 이 파일은 .gitignore에 추가됨 (민감 정보)

### 4. 빌드 및 제출
```bash
cd /Users/simjaehun/Desktop/test/TravelApp

# Android AAB 빌드 (약 15~20분)
npx eas build --platform android --profile production

# Google Play Internal Track에 자동 제출
npx eas submit --platform android --latest
```

### 5. Play Console에서 입력할 내용
- [ ] 스크린샷 업로드 (아래 스펙 참고)
- [ ] 앱 설명 붙여넣기 (app-store-metadata.json 참고)
- [ ] 피처드 그래픽 업로드 (1024×500px)
- [ ] 개인정보 처리방침 URL 입력
- [ ] 콘텐츠 등급 설문 작성 (Everyone 예상)
- [ ] 타겟 연령대 설정
- [ ] 데이터 보안 섹션 작성

### 6. 출시 트랙 선택
| 트랙 | 설명 | 심사 |
|------|------|------|
| 내부 테스트 | 최대 100명 | 없음 (즉시) |
| 비공개 테스트 | 특정 이메일 초대 | 짧음 |
| 공개 테스트 | 누구나 설치 가능 | 있음 |
| 프로덕션 | 정식 출시 | 있음 (1~3일) |

→ 처음엔 **내부 테스트**로 시작 권장

## 📸 Google Play 스크린샷 스펙

| 항목 | 사양 |
|------|------|
| 휴대폰 스크린샷 | 최소 2장, 최대 8장 |
| 해상도 | 최소 320px, 최대 3840px |
| 비율 | 16:9 또는 9:16 |
| 형식 | PNG 또는 JPEG |
| 피처드 그래픽 | 1024×500px (필수) |
| 앱 아이콘 | 512×512px PNG (투명 가능) |

## 📋 앱 기본 정보 (복사해서 사용)

**앱 이름:** PINLOGER  
**패키지명:** com.travelapp.planner  
**카테고리:** 여행 및 현지 정보  
**콘텐츠 등급:** 전체 이용가  
**가격:** 무료  
**개인정보 처리방침:** https://rhino2327.github.io/pinloger/privacy-policy.html  

## 피처드 그래픽 제작 (1024×500px)

Play 스토어 상단에 표시되는 배너 이미지.
아래 스펙으로 직접 만들거나 Canva 무료 이용:
- 배경색: #1a1a2e
- 앱 이름 + 슬로건 + 스크린샷 조합
- 텍스트: PINLOGER | 여행 일정 & 비용 관리
