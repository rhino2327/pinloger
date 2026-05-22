# 앱스토어 제출 체크리스트

## ✅ 완료된 것

- [x] 앱 아이콘 1024×1024px (투명 배경 제거 완료)
- [x] app.json 메타데이터 완성
- [x] eas.json 빌드/제출 설정 완성
- [x] 개인정보 처리방침 HTML 작성 (docs/privacy-policy.html)
- [x] 앱 설명 (한국어/영어) 작성
- [x] 키워드 준비
- [x] 카메라/사진 권한 설명 추가

## ⏳ Apple Developer 승인 후 해야 할 것

### 1. GitHub Pages 활성화 (개인정보 처리방침 URL 확보)
1. GitHub repo → Settings → Pages
2. Source: Deploy from a branch
3. Branch: main / docs 폴더 선택
4. URL 확인: `https://rhino2327.github.io/pinloger/privacy-policy.html`

### 2. App Store Connect에서 앱 등록
1. appstoreconnect.apple.com 접속
2. 나의 앱 → + → 새 앱
3. 플랫폼: iOS
4. 번들 ID: com.travelapp.planner
5. SKU: pinloger-ios-001

### 3. eas.json에 ascAppId 입력
App Store Connect에서 앱 등록 후 App ID 번호를 확인하여:
```json
"submit": {
  "production": {
    "ios": {
      "appleId": "rhino2327@icloud.com",
      "ascAppId": "여기에_앱ID_숫자_입력",
      "appleTeamId": "여기에_팀ID_입력"
    }
  }
}
```

### 4. 빌드 및 제출 실행
```bash
cd /Users/simjaehun/Desktop/test/TravelApp

# Expo 로그인
npx eas login

# iOS 빌드 (약 20~30분)
npx eas build --platform ios --profile production

# App Store Connect에 자동 제출
npx eas submit --platform ios --latest
```

### 5. App Store Connect에서 심사 제출 전 입력
- [ ] 스크린샷 업로드 (store-assets/SCREENSHOT_GUIDE.md 참고)
- [ ] 앱 설명 붙여넣기 (store-assets/app-store-metadata.json 참고)
- [ ] 키워드 입력
- [ ] 개인정보 처리방침 URL 입력
- [ ] 연령 등급 설정 (4+ 예상)
- [ ] 심사용 메모 입력 (테스트 계정 정보)

### 6. 심사 제출
- 예상 소요: 1~7일 (보통 24~48시간)
- 첫 제출이라면 48시간 예상

## 📋 앱 기본 정보 (복사해서 사용)

**앱 이름:** PINLOGER  
**부제목:** 여행 일정 & 비용 관리  
**번들 ID:** com.travelapp.planner  
**카테고리:** 여행 (Travel)  
**연령 등급:** 4+  
**가격:** 무료  
**개인정보 처리방침:** https://rhino2327.github.io/pinloger/privacy-policy.html  
**지원 URL:** https://rhino2327.github.io/pinloger/privacy-policy.html  
